import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $executeRaw: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import { reconcileEngagementCounts } from "./reconcile";

describe("reconcileEngagementCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs four bulk UPDATE statements (likes set + likes orphan, comments set + comments orphan)", async () => {
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(3) // likes set
      .mockResolvedValueOnce(0) // likes orphan
      .mockResolvedValueOnce(7) // comments set
      .mockResolvedValueOnce(0); // comments orphan

    const result = await reconcileEngagementCounts();

    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ likesUpdated: 3, commentsUpdated: 7 });
  });

  it("returns Number-coerced counts (handles bigint/Decimal returns)", async () => {
    mockPrisma.$executeRaw
      .mockResolvedValueOnce(BigInt(2))
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(BigInt(0))
      .mockResolvedValueOnce(0);

    const result = await reconcileEngagementCounts();

    expect(typeof result.likesUpdated).toBe("number");
    expect(typeof result.commentsUpdated).toBe("number");
    expect(result).toEqual({ likesUpdated: 2, commentsUpdated: 0 });
  });
});
