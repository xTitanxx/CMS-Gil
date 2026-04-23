import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const track = await prisma.audioTrack.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!track) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.audioTrack.delete({ where: { id } });
  await deleteObject(track.storageKey).catch(() => {});

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim() : null;
  if (!title) {
    return NextResponse.json({ error: "Title required" }, { status: 400 });
  }
  const existing = await prisma.audioTrack.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await prisma.audioTrack.update({ where: { id }, data: { title } });
  return NextResponse.json({ id: updated.id, title: updated.title });
}
