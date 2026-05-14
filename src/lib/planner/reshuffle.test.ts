import { describe, expect, it } from "vitest";
import {
  computeGenericTags,
  computeShuffledOrder,
  dominantMediaKind,
  proportionalInterleave,
  type ReshufflePost,
} from "./reshuffle";

function postFixture(overrides: Partial<ReshufflePost> & { id: string }): ReshufflePost {
  return {
    tags: [],
    originalDate: new Date("2020-01-01T00:00:00Z"),
    mediaMimeTypes: [],
    ...overrides,
  };
}

describe("computeGenericTags", () => {
  it("flags tags that appear on more than 60% of posts", () => {
    const posts = [
      { id: "a", tags: ["wheelchair", "synagogue"] },
      { id: "b", tags: ["wheelchair", "travel"] },
      { id: "c", tags: ["wheelchair"] },
      { id: "d", tags: ["wheelchair", "synagogue"] },
      { id: "e", tags: ["travel"] },
    ];
    expect(computeGenericTags(posts, 0.6)).toEqual(new Set(["wheelchair"]));
  });

  it("returns empty set on empty input", () => {
    expect(computeGenericTags([], 0.6)).toEqual(new Set());
  });
});

describe("dominantMediaKind", () => {
  it("returns video when any media is video/*", () => {
    expect(dominantMediaKind(["video/mp4"])).toBe("video");
    expect(dominantMediaKind(["image/jpeg", "video/mp4"])).toBe("video");
  });
  it("returns image when no video but at least one image", () => {
    expect(dominantMediaKind(["image/jpeg"])).toBe("image");
    expect(dominantMediaKind(["image/png", "image/jpeg"])).toBe("image");
  });
  it("returns text when no media at all", () => {
    expect(dominantMediaKind([])).toBe("text");
  });
  it("returns text when media is neither image nor video (rare/unknown)", () => {
    expect(dominantMediaKind(["application/pdf"])).toBe("text");
  });
});

describe("proportionalInterleave", () => {
  it("spreads a small bucket across the full length", () => {
    const out = proportionalInterleave({
      video: ["v1", "v2", "v3", "v4", "v5", "v6"],
      image: ["i1", "i2"],
      text: [],
    });
    expect(out).toHaveLength(8);
    const imageIndices = out.flatMap((id, i) => (id.startsWith("i") ? [i] : []));
    expect(imageIndices).toHaveLength(2);
    expect(Math.abs(imageIndices[1] - imageIndices[0])).toBeGreaterThanOrEqual(3);
  });

  it("handles a single non-empty bucket", () => {
    expect(
      proportionalInterleave({ video: ["v1", "v2", "v3"], image: [], text: [] }),
    ).toEqual(["v1", "v2", "v3"]);
  });

  it("handles all empty buckets", () => {
    expect(
      proportionalInterleave({ video: [], image: [], text: [] }),
    ).toEqual([]);
  });

  it("preserves all items exactly once", () => {
    const out = proportionalInterleave({
      video: ["v1", "v2"],
      image: ["i1", "i2"],
      text: ["t1"],
    });
    expect(out.sort()).toEqual(["i1", "i2", "t1", "v1", "v2"]);
  });
});

describe("computeShuffledOrder", () => {
  const now = new Date("2026-05-14T00:00:00Z");

  it("returns empty array on empty input", () => {
    expect(computeShuffledOrder([], { now })).toEqual([]);
  });

  it("places aged posts strictly before recent (<90d) posts", () => {
    const recent1 = postFixture({
      id: "r1",
      originalDate: new Date("2026-05-01T00:00:00Z"),
    });
    const recent2 = postFixture({
      id: "r2",
      originalDate: new Date("2026-03-01T00:00:00Z"),
    });
    const aged1 = postFixture({
      id: "a1",
      originalDate: new Date("2025-01-01T00:00:00Z"),
    });
    const aged2 = postFixture({
      id: "a2",
      originalDate: new Date("2024-06-01T00:00:00Z"),
    });
    const out = computeShuffledOrder([recent1, recent2, aged1, aged2], { now });
    const lastAgedIdx = Math.max(out.indexOf("a1"), out.indexOf("a2"));
    const firstRecentIdx = Math.min(out.indexOf("r1"), out.indexOf("r2"));
    expect(lastAgedIdx).toBeLessThan(firstRecentIdx);
  });

  it("produces a permutation (every input exactly once)", () => {
    const posts: ReshufflePost[] = [];
    for (let i = 0; i < 20; i++) {
      posts.push(
        postFixture({
          id: `p${i}`,
          originalDate: new Date(`2024-0${(i % 9) + 1}-01T00:00:00Z`),
          mediaMimeTypes: [i % 3 === 0 ? "video/mp4" : i % 3 === 1 ? "image/jpeg" : "application/pdf"],
        }),
      );
    }
    const out = computeShuffledOrder(posts, { now });
    expect(out).toHaveLength(20);
    expect(new Set(out).size).toBe(20);
  });

  it("does not de-clump on generic tags only (wheelchair scenario)", () => {
    const posts = Array.from({ length: 6 }, (_, i) =>
      postFixture({
        id: `p${i}`,
        tags: ["wheelchair"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date(`2024-0${i + 1}-01T00:00:00Z`),
      }),
    );
    const out = computeShuffledOrder(posts, { now });
    expect([...out].sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("attempts to break runs of two posts sharing a non-generic tag", () => {
    const posts = [
      postFixture({
        id: "p0",
        tags: ["synagogue"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-01-01T00:00:00Z"),
      }),
      postFixture({
        id: "p1",
        tags: ["synagogue"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-02-01T00:00:00Z"),
      }),
      postFixture({
        id: "p2",
        tags: ["travel"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-03-01T00:00:00Z"),
      }),
      postFixture({
        id: "p3",
        tags: ["food"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-04-01T00:00:00Z"),
      }),
    ];
    const out = computeShuffledOrder(posts, { now, seed: 1 });
    const idx0 = out.indexOf("p0");
    const idx1 = out.indexOf("p1");
    expect(Math.abs(idx0 - idx1)).toBeGreaterThan(1);
  });
});
