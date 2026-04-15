// src/app/api/media/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";
import { z } from "zod";

const body = z.object({
  storageKey: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  sizeBytes: z.number().int().nullable().optional(),
  hasAudio: z.boolean().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;
  const parsed = body.parse(await req.json());

  const existing = await prisma.media.findUnique({ where: { id }, include: { post: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.post.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.media.update({ where: { id }, data: parsed });
  await refreshReadiness(existing.postId);

  return NextResponse.json({ ok: true });
}
