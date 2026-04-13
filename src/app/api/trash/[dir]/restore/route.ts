import { NextResponse } from "next/server";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search-normalize";
import { resolveTrashDir, type TrashedPost } from "@/lib/trash";

// POST — restore every post in a trash directory back to the DB. If a post
// id is already present (e.g., partially restored before), that file is
// skipped. The JSON files remain on disk; call DELETE to purge them after.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ dir: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dir } = await params;
  const full = resolveTrashDir(decodeURIComponent(dir));
  if (!full) {
    return NextResponse.json({ error: "Invalid dir name" }, { status: 400 });
  }

  const postsDir = path.join(full, "posts");
  let files: string[];
  try {
    files = await fs.readdir(postsDir);
  } catch {
    return NextResponse.json({ error: "Trash dir not found" }, { status: 404 });
  }

  let restored = 0;
  let skipped = 0;

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const raw = await fs.readFile(path.join(postsDir, f), "utf8");
    const s = JSON.parse(raw) as TrashedPost & {
      publishes: Array<{
        id: string;
        platform: string;
        status: string;
        scheduledAt: string | null;
        publishedAt: string | null;
        platformPostId: string | null;
        platformUrl: string | null;
        errorMessage: string | null;
        retryCount: number;
        createdAt: string;
        updatedAt: string;
      }>;
      analytics: Array<{
        id: string;
        platform: string;
        platformPostId: string | null;
        reactions: number | null;
        comments: number | null;
        shares: number | null;
        reach: number | null;
        impressions: number | null;
        fetchedAt: string;
        updatedAt: string;
      }>;
      media: Array<{
        id: string;
        storageKey: string;
        originalUri: string | null;
        mimeType: string;
        width: number | null;
        height: number | null;
        sizeBytes: number | null;
        altText: string | null;
        hasAudio: boolean | null;
        createdAt: string;
      }>;
    };

    const exists = await prisma.post.findUnique({ where: { id: s.id } });
    if (exists) {
      skipped++;
      continue;
    }

    await prisma.post.create({
      data: {
        id: s.id,
        userId: s.userId,
        body: s.body,
        bodyHtml: s.bodyHtml,
        bodyNormalized: normalizeForSearch(s.body),
        source: s.source as "FACEBOOK" | "MANUAL",
        sourceId: s.sourceId,
        originalDate: new Date(s.originalDate),
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        tags: s.tags,
        media: {
          create: s.media.map((m) => ({
            id: m.id,
            storageKey: m.storageKey,
            originalUri: m.originalUri,
            mimeType: m.mimeType,
            width: m.width,
            height: m.height,
            sizeBytes: m.sizeBytes,
            altText: m.altText,
            hasAudio: m.hasAudio,
            createdAt: new Date(m.createdAt),
          })),
        },
        publishes: {
          create: s.publishes.map((p) => ({
            id: p.id,
            platform: p.platform as never,
            status: p.status as never,
            scheduledAt: p.scheduledAt ? new Date(p.scheduledAt) : null,
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
            platformPostId: p.platformPostId,
            platformUrl: p.platformUrl,
            errorMessage: p.errorMessage,
            retryCount: p.retryCount,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt),
          })),
        },
        analytics: {
          create: s.analytics.map((a) => ({
            id: a.id,
            platform: a.platform as never,
            platformPostId: a.platformPostId,
            reactions: a.reactions,
            comments: a.comments,
            shares: a.shares,
            reach: a.reach,
            impressions: a.impressions,
            fetchedAt: new Date(a.fetchedAt),
            updatedAt: new Date(a.updatedAt),
          })),
        },
      },
    });
    restored++;
  }

  return NextResponse.json({ restored, skipped });
}
