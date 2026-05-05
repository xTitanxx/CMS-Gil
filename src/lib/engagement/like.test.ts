import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    postLike: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
    post: {
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { toggleLike, getLikedPostIds } from "./like";

describe("toggleLike", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a like when none exists, recomputes and persists count", async () => {
    mockPrisma.postLike.findUnique.mockResolvedValueOnce(null);
    mockPrisma.postLike.create.mockResolvedValueOnce({ id: "l1" });
    mockPrisma.postLike.count.mockResolvedValueOnce(7);
    mockPrisma.post.update.mockResolvedValueOnce({});

    const result = await toggleLike("post1", "sub1");

    expect(result).toEqual({ liked: true, count: 7 });
    expect(mockPrisma.postLike.create).toHaveBeenCalledWith({
      data: { postId: "post1", subscriberId: "sub1" },
    });
    expect(mockPrisma.postLike.delete).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "post1" },
      data: { likeCount: 7 },
    });
  });

  it("deletes the like when one exists, recomputes and persists count", async () => {
    mockPrisma.postLike.findUnique.mockResolvedValueOnce({ id: "l1" });
    mockPrisma.postLike.delete.mockResolvedValueOnce({});
    mockPrisma.postLike.count.mockResolvedValueOnce(2);
    mockPrisma.post.update.mockResolvedValueOnce({});

    const result = await toggleLike("post1", "sub1");

    expect(result).toEqual({ liked: false, count: 2 });
    expect(mockPrisma.postLike.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
    expect(mockPrisma.postLike.create).not.toHaveBeenCalled();
    expect(mockPrisma.post.update).toHaveBeenCalledWith({
      where: { id: "post1" },
      data: { likeCount: 2 },
    });
  });

  it("queries by composite (postId, subscriberId) for existence check", async () => {
    mockPrisma.postLike.findUnique.mockResolvedValueOnce(null);
    mockPrisma.postLike.create.mockResolvedValueOnce({});
    mockPrisma.postLike.count.mockResolvedValueOnce(1);

    await toggleLike("post1", "sub1");

    expect(mockPrisma.postLike.findUnique).toHaveBeenCalledWith({
      where: { postId_subscriberId: { postId: "post1", subscriberId: "sub1" } },
      select: { id: true },
    });
  });
});

describe("getLikedPostIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the postIds the subscriber has liked from the candidate set", async () => {
    mockPrisma.postLike.findMany.mockResolvedValueOnce([
      { postId: "p1" },
      { postId: "p3" },
    ]);

    const result = await getLikedPostIds("sub1", ["p1", "p2", "p3"]);

    expect(result).toEqual(["p1", "p3"]);
    expect(mockPrisma.postLike.findMany).toHaveBeenCalledWith({
      where: { subscriberId: "sub1", postId: { in: ["p1", "p2", "p3"] } },
      select: { postId: true },
    });
  });

  it("short-circuits on empty postIds without hitting prisma", async () => {
    const result = await getLikedPostIds("sub1", []);
    expect(result).toEqual([]);
    expect(mockPrisma.postLike.findMany).not.toHaveBeenCalled();
  });
});
