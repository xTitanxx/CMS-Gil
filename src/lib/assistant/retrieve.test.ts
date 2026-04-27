import { describe, it, expect } from "vitest";
import { rankHits, extractSnippet } from "./retrieve";

const baseSlim = {
  bodyNormalized: "",
  stars: null,
  lifecycle: "EVERGREEN" as const,
  thumbUrl: null,
  contentKind: "short-text" as const,
  platformUrl: null,
};

describe("rankHits", () => {
  it("sorts by tag matches > keyword hits", () => {
    const ranked = rankHits(
      [
        { ...baseSlim, id: "a", body: "foo bar", tags: ["x"] },
        { ...baseSlim, id: "b", body: "foo bar baz", tags: ["x", "y"] },
      ],
      { tags: ["x", "y"], keywords: ["foo"] },
    );
    expect(ranked[0].postId).toBe("b");
  });

  it("adds rating boost", () => {
    const ranked = rankHits(
      [
        { ...baseSlim, id: "a", body: "foo", tags: ["x"], stars: 5 },
        { ...baseSlim, id: "b", body: "foo", tags: ["x"] },
      ],
      { tags: ["x"], keywords: [] },
    );
    expect(ranked[0].postId).toBe("a");
  });

  it("matches keywords through normalization (smart quotes)", () => {
    // body has a curly apostrophe; user typed a straight apostrophe.
    const ranked = rankHits(
      [
        { ...baseSlim, id: "a", body: "I’m thinking about gardening", tags: [] },
        { ...baseSlim, id: "b", body: "totally unrelated text", tags: [] },
      ],
      { tags: [], keywords: ["i'm"] },
    );
    expect(ranked[0].postId).toBe("a");
    expect(ranked[0].matchReasons.some((r) => r.includes("keyword"))).toBe(true);
  });

  it("boosts and labels exact-phrase matches above keyword-only hits", () => {
    const ranked = rankHits(
      [
        { ...baseSlim, id: "kw", body: "I have a bunny living in the garden", tags: [] },
        { ...baseSlim, id: "phrase", body: "the quiet bunny watched the moon rise softly", tags: [] },
      ],
      { tags: [], keywords: ["bunny"] },
      "the quiet bunny watched the moon rise",
    );
    expect(ranked[0].postId).toBe("phrase");
    expect(ranked[0].matchReasons[0]).toBe("exact phrase match");
  });

  it("phrase boost survives smart-quote/em-dash divergence between body and query", () => {
    // Body uses curly quotes + em-dash; query uses straight quotes + hyphens.
    const body = "She said “we’ll try again — tomorrow” and smiled";
    const ranked = rankHits(
      [{ ...baseSlim, id: "p", body, tags: [] }],
      { tags: [], keywords: [] },
      'she said "we\'ll try again - tomorrow" and smiled',
    );
    expect(ranked[0].matchReasons[0]).toBe("exact phrase match");
  });
});

describe("extractSnippet", () => {
  it("returns first keyword hit with context", () => {
    const body = "This is a long body about breathwork and mornings and rituals";
    expect(extractSnippet(body, ["breathwork"])).toContain("breathwork");
  });

  it("falls back to first 140 chars when no keywords", () => {
    const body = "x".repeat(300);
    expect(extractSnippet(body, []).length).toBeLessThanOrEqual(143);
  });
});
