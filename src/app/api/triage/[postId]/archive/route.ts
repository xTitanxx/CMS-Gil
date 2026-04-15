import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { postId } = await params;
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.post.update({
    where: { id: postId },
    data: { readiness: "ARCHIVED", archivedAt: new Date(), readinessCheckedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
