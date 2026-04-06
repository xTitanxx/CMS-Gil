import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

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

  await deleteObject(media.storageKey, media.mimeType).catch((err) => {
    console.error("[media/delete] Cloudinary delete failed", { mediaId, storageKey: media.storageKey, err });
  });
  await prisma.media.delete({ where: { id: mediaId } });

  return NextResponse.json({ ok: true });
}
