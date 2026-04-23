import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const body = z.object({
  postId: z.string(),
  stars: z.number().int().min(1).max(5),
  reasons: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const data = body.parse(await req.json());
  const post = await prisma.post.findUnique({ where: { id: data.postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const rating = await prisma.postRating.upsert({
    where: { postId: data.postId },
    create: { postId: data.postId, stars: data.stars, reasons: data.reasons, note: data.note ?? null },
    update: { stars: data.stars, reasons: data.reasons, note: data.note ?? null },
  });
  return NextResponse.json(rating);
}
