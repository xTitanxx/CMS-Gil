import { describe, expect, it } from "vitest";
import {
  computeGenericTags,
  dominantMediaKind,
  proportionalInterleave,
} from "./reshuffle";

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
