import { describe, it, expect } from "vitest";
import { rankHits, extractSnippet } from "./retrieve";

describe("rankHits", () => {
  it("sorts by tag matches > keyword hits", () => {
    const ranked = rankHits(
      [
        { id: "a", body: "foo bar", tags: ["x"], stars: null, lifecycle: "EVERGREEN" as const, thumbUrl: null, contentKind: "short-text" as const},
        { id: "b", body: "foo bar baz", tags: ["x", "y"], stars: null, lifecycle: "EVERGREEN" as const, thumbUrl: null, contentKind: "short-text" as const},
      ],
      { tags: ["x", "y"], keywords: ["foo"] },
    );
    expect(ranked[0].postId).toBe("b");
  });

  it("adds rating boost", () => {
    const ranked = rankHits(
      [
        { id: "a", body: "foo", tags: ["x"], stars: 5, lifecycle: "EVERGREEN" as const, thumbUrl: null, contentKind: "short-text" as const},
        { id: "b", body: "foo", tags: ["x"], stars: null, lifecycle: "EVERGREEN" as const, thumbUrl: null, contentKind: "short-text" as const},
      ],
      { tags: ["x"], keywords: [] },
    );
    expect(ranked[0].postId).toBe("a");
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
