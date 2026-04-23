import { describe, it, expect } from "vitest";
import { parseTagsFromResponse, parseAnalyzeResponse } from "./analyze-post";

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

describe("parseAnalyzeResponse", () => {
  it("parses full object response", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["beach","sunset"],"lifecycle":"EVERGREEN","season":null}'
    );
    expect(r).toEqual({ tags: ["beach", "sunset"], lifecycle: "EVERGREEN", season: null });
  });

  it("parses seasonal with season set", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["pesach"],"lifecycle":"SEASONAL","season":"SPRING"}'
    );
    expect(r.lifecycle).toBe("SEASONAL");
    expect(r.season).toBe("SPRING");
  });

  it("lowercases tags", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["Beach","SUNSET"],"lifecycle":"EVERGREEN","season":null}'
    );
    expect(r.tags).toEqual(["beach", "sunset"]);
  });

  it("falls back to UNKNOWN for invalid lifecycle", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["x"],"lifecycle":"WEIRD","season":null}'
    );
    expect(r.lifecycle).toBe("UNKNOWN");
  });

  it("returns empty fallback on malformed JSON", () => {
    expect(parseAnalyzeResponse("nope")).toEqual({
      tags: [], lifecycle: "UNKNOWN", season: null,
    });
  });

  it("falls back from legacy bare-array response", () => {
    const r = parseAnalyzeResponse('["beach","sunset"]');
    expect(r.tags).toEqual(["beach", "sunset"]);
    expect(r.lifecycle).toBe("UNKNOWN");
  });
});
