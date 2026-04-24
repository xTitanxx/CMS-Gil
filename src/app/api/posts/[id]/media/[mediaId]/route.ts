import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject, getMediaUrl } from "@/lib/storage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId, mediaId } = await params;

  const media = await prisma.media.findFirst({
    where: { id: mediaId, post: { id: postId, userId: session.user.id } },
  });

  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteObject(media.storageKey).catch((err) => {
    console.error("[media/delete] R2 delete failed", { mediaId, storageKey: media.storageKey, err });
  });
  await prisma.media.delete({ where: { id: mediaId } });

  return NextResponse.json({ ok: true });
}

/**
 * PATCH — set or clear the audio overlay track for a video media item.
 * Body: { audioTrackId: string | null }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId, mediaId } = await params;
  const body = await req.json().catch(() => ({}));
  const audioTrackId = (body?.audioTrackId ?? null) as string | null;

  const media = await prisma.media.findFirst({
    where: { id: mediaId, post: { id: postId, userId: session.user.id } },
  });
  if (!media) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!media.mimeType.startsWith("video/")) {
    return NextResponse.json({ error: "Audio overlay only applies to videos" }, { status: 400 });
  }

  if (audioTrackId) {
    const track = await prisma.audioTrack.findFirst({
      where: { id: audioTrackId, userId: session.user.id },
    });
    if (!track) {
      return NextResponse.json({ error: "Audio track not found" }, { status: 404 });
    }
  }

  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: { audioTrackId },
    include: { audioTrack: { select: { id: true, title: true, storageKey: true } } },
  });

  const url = await getMediaUrl(updated).catch(() => null);

  return NextResponse.json({
    id: updated.id,
    mimeType: updated.mimeType,
    hasAudio: updated.hasAudio,
    audioTrack: updated.audioTrack
      ? { id: updated.audioTrack.id, title: updated.audioTrack.title }
      : null,
    url,
  });
}
