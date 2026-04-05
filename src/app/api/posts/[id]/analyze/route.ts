import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzePost } from "@/lib/analyze-post";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify the post belongs to this user
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tags = await analyzePost(id);
  return NextResponse.json({ tags });
}
