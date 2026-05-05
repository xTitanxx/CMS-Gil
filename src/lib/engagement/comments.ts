import { prisma } from "@/lib/prisma";

export const COMMENT_BODY_MAX = 2000;

export type CommentStatus = "PUBLISHED" | "HIDDEN";

export interface CommentDTO {
  id: string;
  postId: string;
  body: string;
  authorName: string;
  authorIsMine: boolean;
  createdAt: string;
  editedAt: string | null;
  status: CommentStatus;
}

export interface ListCommentsResult {
  comments: CommentDTO[];
  nextCursor: string | null;
}

export class CommentValidationError extends Error {
  constructor(public code: "empty" | "too_long") {
    super(code);
  }
}

export class CommentNotFoundError extends Error {
  constructor() {
    super("not_found");
  }
}

export class CommentForbiddenError extends Error {
  constructor(public code: "not_author" | "comments_disabled") {
    super(code);
  }
}

function normalizeBody(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new CommentValidationError("empty");
  if (trimmed.length > COMMENT_BODY_MAX) throw new CommentValidationError("too_long");
  return trimmed;
}

function toDTO(
  c: {
    id: string;
    postId: string;
    body: string;
    status: CommentStatus;
    editedAt: Date | null;
    createdAt: Date;
    subscriberId: string;
    subscriber: { name: string; displayName: string | null };
  },
  viewerSubscriberId: string | null
): CommentDTO {
  const isHidden = c.status === "HIDDEN";
  return {
    id: c.id,
    postId: c.postId,
    body: isHidden ? "[deleted]" : c.body,
    authorName: c.subscriber.displayName ?? c.subscriber.name,
    authorIsMine: viewerSubscriberId !== null && viewerSubscriberId === c.subscriberId,
    createdAt: c.createdAt.toISOString(),
    editedAt: c.editedAt?.toISOString() ?? null,
    status: c.status,
  };
}

const PAGE_SIZE = 20;

export async function listComments(
  postId: string,
  cursor: string | null,
  viewerSubscriberId: string | null
): Promise<ListCommentsResult> {
  const cursorDate = cursor ? new Date(cursor) : null;

  const rows = await prisma.postComment.findMany({
    where: {
      postId,
      status: "PUBLISHED",
      ...(cursorDate ? { createdAt: { gt: cursorDate } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      postId: true,
      body: true,
      status: true,
      editedAt: true,
      createdAt: true,
      subscriberId: true,
      subscriber: { select: { name: true, displayName: true } },
    },
  });

  const hasMore = rows.length > PAGE_SIZE;
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
  const nextCursor = hasMore ? page[page.length - 1].createdAt.toISOString() : null;

  return {
    comments: page.map((r) =>
      toDTO({ ...r, status: r.status as CommentStatus }, viewerSubscriberId)
    ),
    nextCursor,
  };
}

export async function createComment(opts: {
  postId: string;
  subscriberId: string;
  body: string;
  displayName?: string | null;
}): Promise<CommentDTO> {
  const body = normalizeBody(opts.body);

  const sub = await prisma.subscriber.findUnique({
    where: { id: opts.subscriberId },
    select: {
      name: true,
      displayName: true,
      commentsDisabledAt: true,
    },
  });
  if (!sub) throw new CommentForbiddenError("not_author");
  if (sub.commentsDisabledAt) throw new CommentForbiddenError("comments_disabled");

  let effectiveDisplayName = sub.displayName;
  if (!sub.displayName && opts.displayName != null) {
    const dn = opts.displayName.trim();
    if (dn.length === 0 || dn.length > 50) throw new CommentValidationError("empty");
    await prisma.subscriber.update({
      where: { id: opts.subscriberId },
      data: { displayName: dn },
    });
    effectiveDisplayName = dn;
  }

  const created = await prisma.postComment.create({
    data: {
      postId: opts.postId,
      subscriberId: opts.subscriberId,
      body,
      status: "PUBLISHED",
    },
    select: {
      id: true,
      postId: true,
      body: true,
      status: true,
      editedAt: true,
      createdAt: true,
      subscriberId: true,
    },
  });

  const count = await prisma.postComment.count({
    where: { postId: opts.postId, status: "PUBLISHED" },
  });
  await prisma.post.update({
    where: { id: opts.postId },
    data: { commentCount: count },
  });

  return toDTO(
    {
      ...created,
      status: created.status as CommentStatus,
      subscriber: { name: sub.name, displayName: effectiveDisplayName },
    },
    opts.subscriberId
  );
}

export async function editComment(opts: {
  commentId: string;
  subscriberId: string;
  body: string;
}): Promise<CommentDTO> {
  const body = normalizeBody(opts.body);

  const existing = await prisma.postComment.findUnique({
    where: { id: opts.commentId },
    select: { id: true, subscriberId: true, status: true, postId: true },
  });
  if (!existing) throw new CommentNotFoundError();
  if (existing.subscriberId !== opts.subscriberId) {
    throw new CommentForbiddenError("not_author");
  }

  const updated = await prisma.postComment.update({
    where: { id: opts.commentId },
    data: { body, editedAt: new Date() },
    select: {
      id: true,
      postId: true,
      body: true,
      status: true,
      editedAt: true,
      createdAt: true,
      subscriberId: true,
      subscriber: { select: { name: true, displayName: true } },
    },
  });

  return toDTO({ ...updated, status: updated.status as CommentStatus }, opts.subscriberId);
}

export async function deleteComment(opts: {
  commentId: string;
  subscriberId: string;
}): Promise<{ ok: true }> {
  const existing = await prisma.postComment.findUnique({
    where: { id: opts.commentId },
    select: { id: true, subscriberId: true, postId: true, status: true },
  });
  if (!existing) throw new CommentNotFoundError();
  if (existing.subscriberId !== opts.subscriberId) {
    throw new CommentForbiddenError("not_author");
  }

  await prisma.postComment.delete({ where: { id: opts.commentId } });

  if (existing.status === "PUBLISHED") {
    const count = await prisma.postComment.count({
      where: { postId: existing.postId, status: "PUBLISHED" },
    });
    await prisma.post.update({
      where: { id: existing.postId },
      data: { commentCount: count },
    });
  }

  return { ok: true };
}
