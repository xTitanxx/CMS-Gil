import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    postComment: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    subscriber: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    post: {
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  CommentForbiddenError,
  CommentNotFoundError,
  CommentValidationError,
  createComment,
  deleteComment,
  editComment,
  listComments,
} from "./comments";

const NOW = new Date("2026-05-05T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("createComment", () => {
  it("rejects empty body", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue({
      name: "N",
      displayName: null,
      commentsDisabledAt: null,
    });
    await expect(
      createComment({ postId: "p1", subscriberId: "s1", body: "   " })
    ).rejects.toBeInstanceOf(CommentValidationError);
  });

  it("rejects when subscriber is not found", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue(null);
    await expect(
      createComment({ postId: "p1", subscriberId: "s1", body: "hi" })
    ).rejects.toBeInstanceOf(CommentForbiddenError);
  });

  it("rejects when commentsDisabledAt is set", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue({
      name: "N",
      displayName: "Eitan",
      commentsDisabledAt: NOW,
    });
    await expect(
      createComment({ postId: "p1", subscriberId: "s1", body: "hi" })
    ).rejects.toMatchObject({ code: "comments_disabled" });
  });

  it("never writes Subscriber.displayName during a comment", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue({
      name: "Real Name",
      displayName: null,
      commentsDisabledAt: null,
    });
    mockPrisma.postComment.create.mockResolvedValue({
      id: "c1",
      postId: "p1",
      body: "hi",
      status: "PUBLISHED",
      editedAt: null,
      createdAt: NOW,
      subscriberId: "s1",
    });
    mockPrisma.postComment.count.mockResolvedValue(1);
    mockPrisma.post.update.mockResolvedValue({});

    await createComment({ postId: "p1", subscriberId: "s1", body: "hi" });

    expect(mockPrisma.subscriber.update).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { commentCount: 1 },
    });
  });

  it("uses subscriber.displayName when one is already set", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue({
      name: "Real Name",
      displayName: "AlreadySet",
      commentsDisabledAt: null,
    });
    mockPrisma.postComment.create.mockResolvedValue({
      id: "c1",
      postId: "p1",
      body: "hi",
      status: "PUBLISHED",
      editedAt: null,
      createdAt: NOW,
      subscriberId: "s1",
    });
    mockPrisma.postComment.count.mockResolvedValue(2);
    mockPrisma.post.update.mockResolvedValue({});

    const result = await createComment({
      postId: "p1",
      subscriberId: "s1",
      body: "hi",
    });

    expect(result.authorName).toBe("AlreadySet");
  });

  it("falls back to subscriber.name when displayName is null", async () => {
    mockPrisma.subscriber.findUnique.mockResolvedValue({
      name: "Real Name",
      displayName: null,
      commentsDisabledAt: null,
    });
    mockPrisma.postComment.create.mockResolvedValue({
      id: "c1",
      postId: "p1",
      body: "hi",
      status: "PUBLISHED",
      editedAt: null,
      createdAt: NOW,
      subscriberId: "s1",
    });
    mockPrisma.postComment.count.mockResolvedValue(1);
    mockPrisma.post.update.mockResolvedValue({});

    const result = await createComment({
      postId: "p1",
      subscriberId: "s1",
      body: "hi",
    });

    expect(result.authorName).toBe("Real Name");
  });
});

describe("editComment", () => {
  it("rejects edit by non-author", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      subscriberId: "OWNER",
      status: "PUBLISHED",
      postId: "p1",
    });
    await expect(
      editComment({ commentId: "c1", subscriberId: "INTRUDER", body: "evil" })
    ).rejects.toMatchObject({ code: "not_author" });
  });

  it("allows edit anytime by the author and sets editedAt", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      subscriberId: "s1",
      status: "PUBLISHED",
      postId: "p1",
    });
    mockPrisma.postComment.update.mockResolvedValue({
      id: "c1",
      postId: "p1",
      body: "fixed",
      status: "PUBLISHED",
      editedAt: NOW,
      createdAt: new Date("2025-01-01"),
      subscriberId: "s1",
      subscriber: { name: "N", displayName: "DN" },
    });

    const result = await editComment({
      commentId: "c1",
      subscriberId: "s1",
      body: "fixed",
    });

    expect(result.body).toBe("fixed");
    expect(result.editedAt).toBe(NOW.toISOString());
    expect(mockPrisma.postComment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ body: "fixed", editedAt: expect.any(Date) }),
      })
    );
  });

  it("returns NotFound for missing comment", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue(null);
    await expect(
      editComment({ commentId: "missing", subscriberId: "s1", body: "x" })
    ).rejects.toBeInstanceOf(CommentNotFoundError);
  });
});

describe("deleteComment", () => {
  it("hard-deletes the row and decrements commentCount", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      subscriberId: "s1",
      postId: "p1",
      status: "PUBLISHED",
    });
    mockPrisma.postComment.delete.mockResolvedValue({});
    mockPrisma.postComment.count.mockResolvedValue(3);
    mockPrisma.post.update.mockResolvedValue({});

    const result = await deleteComment({ commentId: "c1", subscriberId: "s1" });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.postComment.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { commentCount: 3 },
    });
  });

  it("rejects delete by non-author", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      subscriberId: "OWNER",
      postId: "p1",
      status: "PUBLISHED",
    });
    await expect(
      deleteComment({ commentId: "c1", subscriberId: "INTRUDER" })
    ).rejects.toMatchObject({ code: "not_author" });
  });

  it("does not recompute count when deleting an already-HIDDEN comment", async () => {
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      subscriberId: "s1",
      postId: "p1",
      status: "HIDDEN",
    });
    mockPrisma.postComment.delete.mockResolvedValue({});

    await deleteComment({ commentId: "c1", subscriberId: "s1" });

    expect(mockPrisma.postComment.count).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).not.toHaveBeenCalled();
  });
});

describe("hideComment / restoreComment", () => {
  it("hideComment marks PUBLISHED → HIDDEN and recomputes count", async () => {
    const { hideComment } = await import("./comments");
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      postId: "p1",
      status: "PUBLISHED",
    });
    mockPrisma.postComment.update.mockResolvedValue({});
    mockPrisma.postComment.count.mockResolvedValue(2);
    mockPrisma.post.update.mockResolvedValue({});

    const result = await hideComment("c1");

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.postComment.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "HIDDEN", deletedAt: expect.any(Date) },
    });
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { commentCount: 2 },
    });
  });

  it("hideComment on already-HIDDEN row skips count recompute", async () => {
    const { hideComment } = await import("./comments");
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      postId: "p1",
      status: "HIDDEN",
    });
    mockPrisma.postComment.update.mockResolvedValue({});

    await hideComment("c1");

    expect(mockPrisma.postComment.count).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).not.toHaveBeenCalled();
  });

  it("restoreComment marks HIDDEN → PUBLISHED and recomputes count", async () => {
    const { restoreComment } = await import("./comments");
    mockPrisma.postComment.findUnique.mockResolvedValue({
      id: "c1",
      postId: "p1",
      status: "HIDDEN",
    });
    mockPrisma.postComment.update.mockResolvedValue({});
    mockPrisma.postComment.count.mockResolvedValue(5);
    mockPrisma.post.update.mockResolvedValue({});

    await restoreComment("c1");

    expect(mockPrisma.postComment.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "PUBLISHED", deletedAt: null },
    });
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { commentCount: 5 },
    });
  });
});

describe("listComments", () => {
  it("flags own comments as authorIsMine when viewerSubscriberId matches", async () => {
    mockPrisma.postComment.findMany.mockResolvedValue([
      {
        id: "c1",
        postId: "p1",
        body: "hi",
        status: "PUBLISHED",
        editedAt: null,
        createdAt: NOW,
        subscriberId: "MINE",
        subscriber: { name: "N", displayName: "DN" },
      },
      {
        id: "c2",
        postId: "p1",
        body: "yo",
        status: "PUBLISHED",
        editedAt: null,
        createdAt: NOW,
        subscriberId: "OTHER",
        subscriber: { name: "Other", displayName: null },
      },
    ]);

    const { comments } = await listComments("p1", null, "MINE");
    expect(comments[0].authorIsMine).toBe(true);
    expect(comments[1].authorIsMine).toBe(false);
    expect(comments[1].authorName).toBe("Other"); // null displayName → name fallback
  });

  it("returns nextCursor when there are more rows than the page size", async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      id: `c${i}`,
      postId: "p1",
      body: `body ${i}`,
      status: "PUBLISHED" as const,
      editedAt: null,
      createdAt: new Date(`2026-05-05T12:00:${String(i).padStart(2, "0")}Z`),
      subscriberId: "s1",
      subscriber: { name: "N", displayName: null },
    }));
    mockPrisma.postComment.findMany.mockResolvedValue(rows);

    const result = await listComments("p1", null, null);
    expect(result.comments).toHaveLength(20);
    expect(result.nextCursor).toBe(rows[19].createdAt.toISOString());
  });
});
