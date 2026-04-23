import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Accept the AI-suggested caption: replace body with captionSuggestion and
 * clear the suggestion (and re-run analysis fields — the new caption needs
 * fresh quality/evergreen signals, but that happens lazily on next bulk run).
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, captionSuggestion: true },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!post.captionSuggestion)
    return NextResponse.json({ error: "no suggestion to accept" }, { status: 400 });

  const updated = await prisma.post.update({
    where: { id: post.id },
    data: {
      body: post.captionSuggestion,
      captionSuggestion: null,
      captionAnalyzedAt: null, // invalidate analysis so next bulk run picks it up
      captionQuality: null,
      captionEvergreen: null,
    },
    select: { id: true, body: true },
  });
  return NextResponse.json({ ok: true, post: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.post.update({
    where: { id: post.id },
    data: { captionSuggestion: null },
  });
  return NextResponse.json({ ok: true });
}
