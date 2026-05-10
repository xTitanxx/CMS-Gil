import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getHighQualityExamples, suggestCaption } from "@/lib/analyze-caption";

/**
 * Generate a fresh AI caption suggestion for a single post on demand. Used by
 * the Suggester's "Rewrite" chip — calls Sonnet with the user's own
 * high-quality captions as few-shot examples and returns the new text.
 *
 * Side effect: persists the suggestion onto post.captionSuggestion (same
 * field the Triage improvements feed reads), so the same rewrite shows up
 * elsewhere if the user ignores it here.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const examples = await getHighQualityExamples(session.user.id, 6);
  if (examples.length === 0) {
    return NextResponse.json(
      { error: "Need some high-quality captions in your history before AI rewrite is available." },
      { status: 400 },
    );
  }

  const suggestion = await suggestCaption({ postId: post.id, examples });
  if (!suggestion) {
    return NextResponse.json({ error: "rewrite failed" }, { status: 500 });
  }

  return NextResponse.json({ suggestion });
}
