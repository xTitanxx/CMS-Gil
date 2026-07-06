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
  "THREADS",
  "SUBSTACK",
] as const;

// The two outcomes the manual queue writes: PUBLISHED ("I posted it") or
// CANCELLED ("Skip / not posting"). Both clear the post from the queue;
// only PUBLISHED counts as a real publish.
const MANUAL_STATUSES: readonly PublishStatus[] = ["PUBLISHED", "CANCELLED"] as const;

const body = z.object({
  platform: z.enum(PLATFORMS as [Platform, ...Platform[]]).optional(),
  platformUrl: z.string().url().optional(),
  status: z
    .enum(MANUAL_STATUSES as [PublishStatus, ...PublishStatus[]])
    .optional(),
});

/**
 * Manual queue write — used by `/admin/m/[postId]` and `/admin/manual-fb` to
 * record that the user either posted the item to FB personal themselves
 * (PUBLISHED) or declined to post it (CANCELLED / "Skip"). Both outcomes
 * remove the post from the manual queue. Defaults to PUBLISHED for the
 * existing helper UI which only marks-as-posted.
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
  const status = parsed.data.status ?? "PUBLISHED";

  const record = await prisma.publishRecord.create({
    data: {
      postId: post.id,
      platform,
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      platformUrl,
    },
    select: { id: true },
  });

  // A manual FACEBOOK decision (posted or skipped) always resolves the
  // "needs Facebook" state set by the compose page's share hand-off. Kept
  // for bookkeeping/future use even though no UI currently branches on it —
  // the manual posting helper (/admin/m/[id]) is reachable from every post
  // via the "Post to FB" action rather than being gated on this field.
  if (platform === "FACEBOOK") {
    await prisma.post.update({
      where: { id: post.id },
      data: { fbShareStartedAt: null },
    });
  }

  return NextResponse.json({ ok: true, publishRecordId: record.id });
}

/**
 * Undo a manual queue write. Deletes the most recent manual PublishRecord
 * (PUBLISHED or CANCELLED) for this post + platform — used by the History
 * tab to put a post back into the queue.
 *
 * Personal FB has no API publisher, so platform=FACEBOOK records are always
 * manual. For other platforms, we only delete records with no platformPostId
 * so we don't nuke an automated publish by accident.
 */
export async function DELETE(
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

  const url = new URL(req.url);
  const rawPlatform = url.searchParams.get("platform") ?? "FACEBOOK";
  if (!PLATFORMS.includes(rawPlatform as Platform)) {
    return NextResponse.json({ error: "bad platform" }, { status: 400 });
  }
  const platform = rawPlatform as Platform;

  const latest = await prisma.publishRecord.findFirst({
    where: {
      postId: post.id,
      platform,
      status: { in: ["PUBLISHED", "CANCELLED"] },
      ...(platform === "FACEBOOK" ? {} : { platformPostId: null }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!latest) {
    return NextResponse.json({ error: "no manual record" }, { status: 404 });
  }

  await prisma.publishRecord.delete({ where: { id: latest.id } });
  return NextResponse.json({ ok: true, deletedId: latest.id });
}
