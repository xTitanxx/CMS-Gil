import { describe, it, expect } from "vitest";
import { parseTagsFromResponse } from "./analyze-post";

describe("parseTagsFromResponse", () => {
  it("parses a clean JSON array", () => {
    const result = parseTagsFromResponse('["beach", "sunset", "travel"]');
    expect(result).toEqual(["beach", "sunset", "travel"]);
  });

  it("extracts JSON array from surrounding prose", () => {
    const result = parseTagsFromResponse(
      'Here are the tags: ["beach", "sunset"] — let me know if you want more.'
    );
    expect(result).toEqual(["beach", "sunset"]);
  });

  it("lowercases all tags", () => {
    const result = parseTagsFromResponse('["Beach", "SUNSET", "Travel"]');
    expect(result).toEqual(["beach", "sunset", "travel"]);
  });

  it("returns empty array when no JSON array present", () => {
    const result = parseTagsFromResponse("I could not analyze this post.");
    expect(result).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseTagsFromResponse("[beach, sunset]");
    expect(result).toEqual([]);
  });

  it("filters out non-string elements", () => {
    const result = parseTagsFromResponse('["beach", 42, null, "sunset"]');
    expect(result).toEqual(["beach", "sunset"]);
  });
});
