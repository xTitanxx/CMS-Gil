import { describe, it, expect } from "vitest";
import {
  topTagsByFrequency,
  pickStratifiedSample,
  countPostsPerTheme,
  type ArchivePost,
  type Theme,
} from "./archive-understanding";

function post(id: string, body: string, tags: string[], year: number): ArchivePost {
  return {
    id,
    body,
    tags,
    originalDate: new Date(`${year}-06-15T12:00:00Z`),
  };
}

describe("topTagsByFrequency", () => {
  it("ranks tags by post count and returns up to N", () => {
    const posts = [
      post("a", "x", ["alpha", "beta"], 2024),
      post("b", "x", ["alpha", "gamma"], 2024),
      post("c", "x", ["alpha"], 2024),
      post("d", "x", ["beta"], 2024),
    ];
    expect(topTagsByFrequency(posts, 2)).toEqual(["alpha", "beta"]);
    expect(topTagsByFrequency(posts, 10)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("returns empty for no posts", () => {
    expect(topTagsByFrequency([], 5)).toEqual([]);
  });
});

describe("countPostsPerTheme", () => {
  it("counts each post once per theme even if multiple of its tags match", () => {
    const themes: Theme[] = [
      { name: "family", tags: ["dad", "mom", "kids"] },
      { name: "garden", tags: ["plants", "tomato"] },
    ];
    const posts = [
      post("a", "x", ["dad", "mom"], 2024), // family ×1, not ×2
      post("b", "x", ["plants"], 2024), // garden
      post("c", "x", ["dad", "plants"], 2024), // both
    ];
    expect(countPostsPerTheme(posts, themes)).toEqual({ family: 2, garden: 2 });
  });

  it("returns zeros for empty posts", () => {
    const themes: Theme[] = [{ name: "family", tags: ["dad"] }];
    expect(countPostsPerTheme([], themes)).toEqual({ family: 0 });
  });
});

describe("pickStratifiedSample", () => {
  it("returns all posts when fewer than sampleSize available", () => {
    const posts = [post("a", "x", ["dad"], 2024), post("b", "x", ["mom"], 2024)];
    const themes: Theme[] = [{ name: "family", tags: ["dad", "mom"] }];
    const result = pickStratifiedSample(posts, themes, 10);
    expect(result.length).toBe(2);
    expect(new Set(result.map((r) => r.id))).toEqual(new Set(["a", "b"]));
  });

  it("spreads picks across themes", () => {
    const posts: ArchivePost[] = [
      post("f1", "fam one", ["dad"], 2024),
      post("f2", "fam two", ["mom"], 2024),
      post("f3", "fam three", ["dad"], 2024),
      post("g1", "gar one", ["plants"], 2024),
      post("g2", "gar two", ["tomato"], 2024),
    ];
    const themes: Theme[] = [
      { name: "family", tags: ["dad", "mom"] },
      { name: "garden", tags: ["plants", "tomato"] },
    ];
    const result = pickStratifiedSample(posts, themes, 4);
    const themeNames = result.map((r) => r.theme);
    expect(themeNames.filter((t) => t === "family").length).toBeGreaterThan(0);
    expect(themeNames.filter((t) => t === "garden").length).toBeGreaterThan(0);
  });

  it("spreads year coverage within a theme — round-robin across year buckets", () => {
    const posts: ArchivePost[] = [
      post("a", "x", ["dad"], 2020),
      post("b", "x", ["dad"], 2020),
      post("c", "x", ["dad"], 2020),
      post("d", "x", ["dad"], 2024),
    ];
    const themes: Theme[] = [{ name: "family", tags: ["dad"] }];
    const result = pickStratifiedSample(posts, themes, 2);
    // Round-robin should pull one from each year before doubling up on a year.
    const years = result.map((r) => r.originalDate.slice(0, 4));
    expect(new Set(years)).toEqual(new Set(["2020", "2024"]));
  });

  it("falls back to a general bucket when no themes provided", () => {
    const posts = [post("a", "x", ["xx"], 2024), post("b", "y", ["yy"], 2024)];
    const result = pickStratifiedSample(posts, [], 5);
    expect(result.length).toBe(2);
    expect(result.every((r) => r.theme === "(general)")).toBe(true);
  });

  it("captures ungrouped posts in (other) theme when room remains", () => {
    const posts: ArchivePost[] = [
      post("a", "x", ["dad"], 2024),
      post("b", "x", ["weird-tag"], 2024),
      post("c", "x", ["another-orphan"], 2024),
    ];
    const themes: Theme[] = [{ name: "family", tags: ["dad"] }];
    const result = pickStratifiedSample(posts, themes, 3);
    const themeNames = result.map((r) => r.theme);
    expect(themeNames).toContain("family");
    expect(themeNames).toContain("(other)");
  });

  it("returns empty when sampleSize is zero", () => {
    const posts = [post("a", "x", ["dad"], 2024)];
    const themes: Theme[] = [{ name: "family", tags: ["dad"] }];
    expect(pickStratifiedSample(posts, themes, 0)).toEqual([]);
  });
});
