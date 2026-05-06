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
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cursor = req.nextUrl.searchParams.get("cursor");

  const session = await auth();
  // Admin viewing comments is treated as a viewer too — surface their shadow
  // subscriber id so any of the admin's own test comments highlight as "yours".
  const viewer = await resolveActorSubscriberId(session);

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
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const actorId = await resolveActorSubscriberId(session);
  if (!actorId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }

  // Real subscribers can be revoked. Admin shadows are revoked-by-design and
  // bypass the check.
  if (session.user.role === "subscriber") {
    const sub = await prisma.subscriber.findUnique({
      where: { id: actorId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      return NextResponse.json({ error: "revoked" }, { status: 403 });
    }
  }

  const post = await prisma.post.findUnique({ where: { id }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const limit = commentRateLimiter.check(actorId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limit.retryAfterMs },
      { status: 429 }
    );
  }

  let body: { body?: string };
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
      subscriberId: actorId,
      body: body.body,
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
