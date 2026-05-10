import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";
import { z } from "zod";

const body = z.object({ postId: z.string(), undo: z.boolean().optional() });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const { postId, undo } = parsed.data;

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const reasons = new Set(post.notReadyReasons);
  if (undo) {
    reasons.delete("skipped-in-suggester");
  } else {
    reasons.add("skipped-in-suggester");
  }

  await prisma.post.update({
    where: { id: postId },
    data: { notReadyReasons: [...reasons] },
  });
  await refreshReadiness(postId);

  return NextResponse.json({ ok: true });
}
