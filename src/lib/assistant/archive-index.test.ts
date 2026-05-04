import { describe, it, expect } from "vitest";
import { truncateBody, formatEntry, formatIndex, ARCHIVE_INDEX_BODY_CHARS } from "./archive-index";

describe("truncateBody", () => {
  it("returns body unchanged when under cap", () => {
    const out = truncateBody("hello world", 100);
    expect(out).toEqual({ body: "hello world", truncated: false });
  });

  it("trims surrounding whitespace before measuring", () => {
    const out = truncateBody("  hello  ", 100);
    expect(out).toEqual({ body: "hello", truncated: false });
  });

  it("cuts at a word boundary near the cap and appends ellipsis", () => {
    const body = "alpha bravo charlie delta echo foxtrot golf hotel";
    const out = truncateBody(body, 20);
    expect(out.truncated).toBe(true);
    expect(out.body.endsWith("…")).toBe(true);
    expect(out.body.length).toBeLessThanOrEqual(21);
    expect(out.body).not.toContain(" …");
  });

  it("falls back to a hard cut when no word boundary exists in the tail window", () => {
    const body = "a".repeat(2000);
    const out = truncateBody(body, ARCHIVE_INDEX_BODY_CHARS);
    expect(out.truncated).toBe(true);
    expect(out.body).toBe("a".repeat(ARCHIVE_INDEX_BODY_CHARS) + "…");
  });
});

describe("formatEntry", () => {
  it("renders the header line followed by the body", () => {
    const text = formatEntry({
      id: "abc123",
      originalDate: new Date("2024-03-15T12:00:00Z"),
      kind: "POST",
      tags: ["garden", "spring"],
      body: "An afternoon in the garden.",
      truncated: false,
    });
    expect(text).toBe("[post:abc123 | 2024-03-15 | POST | garden, spring]\nAn afternoon in the garden.");
  });

  it("caps tags at 5", () => {
    const text = formatEntry({
      id: "abc",
      originalDate: new Date("2024-03-15T12:00:00Z"),
      kind: "POST",
      tags: ["a", "b", "c", "d", "e", "f", "g"],
      body: "x",
      truncated: false,
    });
    expect(text).toContain("a, b, c, d, e]");
    expect(text).not.toContain("f");
  });
});

describe("formatIndex", () => {
  it("joins entries with a blank line between them", () => {
    const text = formatIndex([
      { id: "p1", originalDate: new Date("2024-08-01"), kind: "POST", tags: [], body: "first", truncated: false },
      { id: "p2", originalDate: new Date("2023-11-20"), kind: "REEL", tags: [], body: "second", truncated: false },
    ]);
    expect(text).toContain("first\n\n[post:p2");
  });

  it("returns an empty string for no entries", () => {
    expect(formatIndex([])).toBe("");
  });
});
