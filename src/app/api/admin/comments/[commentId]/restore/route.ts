import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { CommentNotFoundError, restoreComment } from "@/lib/engagement/comments";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ commentId: string }> }
) {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { commentId } = await params;

  try {
    const result = await restoreComment(commentId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CommentNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}
