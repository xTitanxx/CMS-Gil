import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    postBookmark: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { toggleBookmark, getBookmarkedPostIds } from "./bookmark";

describe("toggleBookmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a bookmark when none exists", async () => {
    mockPrisma.postBookmark.findUnique.mockResolvedValueOnce(null);
    mockPrisma.postBookmark.create.mockResolvedValueOnce({ id: "b1" });

    const result = await toggleBookmark("post1", "sub1");

    expect(result).toEqual({ bookmarked: true });
    expect(mockPrisma.postBookmark.create).toHaveBeenCalledWith({
      data: { postId: "post1", subscriberId: "sub1" },
    });
    expect(mockPrisma.postBookmark.delete).not.toHaveBeenCalled();
  });

  it("removes a bookmark when one exists", async () => {
    mockPrisma.postBookmark.findUnique.mockResolvedValueOnce({ id: "b1" });
    mockPrisma.postBookmark.delete.mockResolvedValueOnce({});

    const result = await toggleBookmark("post1", "sub1");

    expect(result).toEqual({ bookmarked: false });
    expect(mockPrisma.postBookmark.delete).toHaveBeenCalledWith({ where: { id: "b1" } });
    expect(mockPrisma.postBookmark.create).not.toHaveBeenCalled();
  });

  it("scopes existence check to the (postId, subscriberId) pair — subscriber A's bookmark doesn't affect subscriber B", async () => {
    mockPrisma.postBookmark.findUnique.mockResolvedValueOnce(null);
    mockPrisma.postBookmark.create.mockResolvedValueOnce({});

    await toggleBookmark("post1", "subA");

    expect(mockPrisma.postBookmark.findUnique).toHaveBeenCalledWith({
      where: { postId_subscriberId: { postId: "post1", subscriberId: "subA" } },
      select: { id: true },
    });
  });
});

describe("getBookmarkedPostIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the postIds the subscriber has bookmarked from the candidate set", async () => {
    mockPrisma.postBookmark.findMany.mockResolvedValueOnce([{ postId: "p2" }]);

    const result = await getBookmarkedPostIds("sub1", ["p1", "p2", "p3"]);

    expect(result).toEqual(["p2"]);
    expect(mockPrisma.postBookmark.findMany).toHaveBeenCalledWith({
      where: { subscriberId: "sub1", postId: { in: ["p1", "p2", "p3"] } },
      select: { postId: true },
    });
  });

  it("short-circuits on empty postIds", async () => {
    const result = await getBookmarkedPostIds("sub1", []);
    expect(result).toEqual([]);
    expect(mockPrisma.postBookmark.findMany).not.toHaveBeenCalled();
  });
});
