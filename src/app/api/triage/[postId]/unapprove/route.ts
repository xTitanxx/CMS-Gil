import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { postId } = await params;
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Clear the manual-approval marker. refreshReadiness then recomputes
  // readiness from the actual media/body state, which is what the post would
  // have had if the user had never touched it — so if the underlying issue
  // is still present, it lands back in Needs fixes automatically.
  await prisma.post.update({
    where: { id: postId },
    data: { triageApprovedAt: null },
  });
  await refreshReadiness(postId);
  return NextResponse.json({ ok: true });
}
