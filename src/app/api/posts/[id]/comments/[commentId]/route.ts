import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentValidationError,
  COMMENT_BODY_MAX,
  deleteComment,
  editComment,
} from "@/lib/engagement/comments";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { commentId } = await params;

  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const actorId = await resolveActorSubscriberId(session);
  if (!actorId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }
  if (session.user.role === "subscriber") {
    const sub = await prisma.subscriber.findUnique({
      where: { id: actorId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      return NextResponse.json({ error: "revoked" }, { status: 403 });
    }
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
    const comment = await editComment({ commentId, subscriberId: actorId, body: body.body });
    return NextResponse.json({ comment });
  } catch (err) {
    if (err instanceof CommentNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof CommentForbiddenError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    if (err instanceof CommentValidationError) {
      return NextResponse.json(
        { error: err.code, max: COMMENT_BODY_MAX },
        { status: 400 }
      );
    }
    throw err;
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  const { commentId } = await params;

  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauth" }, { status: 401 });

  const actorId = await resolveActorSubscriberId(session);
  if (!actorId) {
    return NextResponse.json({ error: "subscriber_required" }, { status: 403 });
  }

  try {
    const result = await deleteComment({ commentId, subscriberId: actorId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof CommentNotFoundError) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (err instanceof CommentForbiddenError) {
      return NextResponse.json({ error: err.code }, { status: 403 });
    }
    throw err;
  }
}
