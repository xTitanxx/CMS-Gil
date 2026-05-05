import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CommentForbiddenError,
  CommentValidationError,
  COMMENT_BODY_MAX,
  createComment,
  listComments,
} from "@/lib/engagement/comments";
import { commentRateLimiter } from "@/lib/engagement/comment-rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor");

  const session = await auth();
  const viewer = session?.user?.subscriberId ?? null;

  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await listComments(id, cursor, viewer);
  return NextResponse.json(result);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const session = await auth();
  const role = session?.user?.role;
  const subscriberId = session?.user?.subscriberId;

  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });
  if (role !== "subscriber" || !subscriberId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }

  const sub = await prisma.subscriber.findUnique({
    where: { id: subscriberId },
    select: { revokedAt: true },
  });
  if (!sub || sub.revokedAt) {
    return NextResponse.json({ error: "revoked" }, { status: 403 });
  }

  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = commentRateLimiter.check(subscriberId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 }
    );
  }

  let body: { body?: string; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  if (typeof body?.body !== "string") {
    return NextResponse.json({ error: "missing_body" }, { status: 400 });
  }

  try {
    const comment = await createComment({
      postId: id,
      subscriberId,
      body: body.body,
      displayName: body.displayName,
    });
    return NextResponse.json({ comment });
  } catch (err) {
    if (err instanceof CommentValidationError) {
      return NextResponse.json(
        { error: err.code, max: COMMENT_BODY_MAX },
        { status: 400 }
      );
    }
    if (err instanceof CommentForbiddenError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }
}
