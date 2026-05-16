import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// History tab is "what did I clear from the manual queue recently?" — capped
// at 30 days so it stays a working set, not an audit log.
const LOOKBACK_DAYS = 30;
const MAX_RESULTS = 100;

export type HistoryItem = {
  publishRecordId: string;
  postId: string;
  body: string;
  recordedAt: string;
  status: "PUBLISHED" | "CANCELLED";
  media: { id: string; mimeType: string; url: string | null }[];
};

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const records = await prisma.publishRecord.findMany({
    where: {
      platform: "FACEBOOK",
      status: { in: ["PUBLISHED", "CANCELLED"] },
      createdAt: { gte: lookbackStart },
      post: { userId },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_RESULTS,
    select: {
      id: true,
      status: true,
      createdAt: true,
      publishedAt: true,
      post: {
        select: {
          id: true,
          body: true,
          media: {
            select: { id: true, mimeType: true, storageKey: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  // De-dup on postId so a post that was marked → unmarked → marked again only
  // shows once (newest wins, which is what the orderBy above gives us).
  const seenPostIds = new Set<string>();
  const items: HistoryItem[] = [];
  for (const r of records) {
    if (seenPostIds.has(r.post.id)) continue;
    seenPostIds.add(r.post.id);
    items.push({
      publishRecordId: r.id,
      postId: r.post.id,
      body: r.post.body ?? "",
      recordedAt: (r.publishedAt ?? r.createdAt).toISOString(),
      status: r.status as "PUBLISHED" | "CANCELLED",
      media: r.post.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      })),
    });
  }

  return NextResponse.json({ items });
}
