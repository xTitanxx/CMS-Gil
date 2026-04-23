import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";
import { z } from "zod";

const body = z.object({ enabled: z.boolean() });

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { postId } = await params;
  const { enabled } = body.parse(await req.json());

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const reasons = new Set(post.notReadyReasons);
  if (enabled) reasons.add("dont-post"); else reasons.delete("dont-post");
  await prisma.post.update({
    where: { id: postId },
    data: { notReadyReasons: [...reasons] },
  });
  await refreshReadiness(postId);
  return NextResponse.json({ ok: true });
}
