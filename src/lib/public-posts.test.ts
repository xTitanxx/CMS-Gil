// src/lib/public-posts.test.ts
import { describe, it, expect } from "vitest";
import { dedupePosts, type PublicPost } from "./public-posts";

function makePost(id: string, bodyNormalized: string, date: string): PublicPost {
  return {
    id,
    body: bodyNormalized,
    bodyNormalized,
    originalDate: new Date(date),
    tags: [],
    media: [],
  };
}

describe("dedupePosts", () => {
  it("returns posts unchanged when no duplicates exist", () => {
    const posts = [
      makePost("a", "hello world", "2026-01-01"),
      makePost("b", "second post", "2026-01-02"),
    ];
    expect(dedupePosts(posts).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("keeps the oldest post when bodyNormalized duplicates exist", () => {
    // Input ordered newest first (simulates DB result)
    const posts = [
      makePost("newer", "same text", "2026-02-01"),
      makePost("older", "same text", "2026-01-01"),
      makePost("unique", "different", "2026-01-15"),
    ];
    const result = dedupePosts(posts);
    expect(result.map((p) => p.id).sort()).toEqual(["older", "unique"]);
  });

  it("does not dedupe posts with empty bodyNormalized", () => {
    const posts = [
      makePost("a", "", "2026-01-01"),
      makePost("b", "", "2026-01-02"),
    ];
    expect(dedupePosts(posts)).toHaveLength(2);
  });

  it("preserves original order (newest first) after dedup", () => {
    const posts = [
      makePost("a", "one", "2026-03-01"),
      makePost("b", "two", "2026-02-01"),
      makePost("c", "one", "2026-01-01"), // dup of a, older
    ];
    const result = dedupePosts(posts);
    // 'a' is replaced by 'c' (older), but 'c' keeps its original date position? No:
    // the function keeps 'c' as the survivor. Result should be ordered by date desc.
    expect(result.map((p) => p.id)).toEqual(["b", "c"]);
  });
});
