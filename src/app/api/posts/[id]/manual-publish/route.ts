import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform, PublishStatus } from "@prisma/client";
import { z } from "zod";

const PLATFORMS: readonly Platform[] = [
  "FACEBOOK",
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
] as const;

const body = z.object({
  platform: z.enum(PLATFORMS as [Platform, ...Platform[]]).optional(),
  platformUrl: z.string().url().optional(),
});

/**
 * Mark a post as manually published on a given platform — used by the
 * `/admin/m/[postId]` helper after the user pastes the caption into Facebook
 * personal and posts it themselves. Defaults to FACEBOOK (personal profile)
 * since that's the only platform we can't drive via API.
 *
 * Creates a new PublishRecord rather than updating an existing PENDING one,
 * because the manual path may run independently of any scheduled record.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const platform = parsed.data.platform ?? "FACEBOOK";
  const platformUrl = parsed.data.platformUrl ?? null;

  const record = await prisma.publishRecord.create({
    data: {
      postId: post.id,
      platform,
      status: "PUBLISHED" satisfies PublishStatus,
      publishedAt: new Date(),
      platformUrl,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, publishRecordId: record.id });
}
