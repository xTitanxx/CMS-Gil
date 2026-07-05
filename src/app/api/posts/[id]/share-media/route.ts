import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preparePublishKeys } from "@/lib/publish-prep";

/**
 * Mux-aware media URLs for the Facebook-personal share flow (compose page's
 * retry banner). Reuses the same preparePublishKeys() step the automated
 * publish path (/api/posts/[id]/publish) already uses to bake attached
 * music onto a silent video — without it, a post's music would only ever
 * show up in the in-app preview, never in what actually gets shared to
 * Facebook.
 */
export async function GET(
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
    select: {
      media: {
        select: {
          id: true,
          mimeType: true,
          storageKey: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const urls = await preparePublishKeys(session.user.id, post.media);

  return NextResponse.json({
    media: post.media.map((m, i) => ({ id: m.id, mimeType: m.mimeType, url: urls[i] })),
  });
}
