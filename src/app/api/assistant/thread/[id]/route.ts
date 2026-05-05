import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const conv = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const result = await prisma.conversation.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (result.count === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { title?: string } | null;
  if (!body || typeof body.title !== "string")
    return NextResponse.json({ error: "title required" }, { status: 400 });

  const title = body.title.trim().slice(0, 120);
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const result = await prisma.conversation.updateMany({
    where: { id, userId: session.user.id },
    data: { title },
  });
  if (result.count === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
