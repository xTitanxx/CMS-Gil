import { describe, it, expect } from "vitest";
import { tokenizeQuery } from "./keyword-search";

describe("tokenizeQuery", () => {
  it("keeps brand-name / proper-noun tokens regardless of length", () => {
    expect(tokenizeQuery("trekinetic")).toEqual(["trekinetic"]);
    expect(tokenizeQuery("Trekinetic")).toEqual(["trekinetic"]);
  });

  it("ignores punctuation attached to a single content word", () => {
    expect(tokenizeQuery("do you have any posts about trekinetic?")).toEqual([
      "trekinetic",
    ]);
  });

  it("strips question framing and surfaces only the content tokens", () => {
    expect(tokenizeQuery("does Gil talk about depression?")).toEqual([
      "depression",
    ]);
  });

  it("returns an empty list for greetings and filler", () => {
    expect(tokenizeQuery("hi")).toEqual([]);
    expect(tokenizeQuery("thanks!")).toEqual([]);
    expect(tokenizeQuery("you, please")).toEqual([]);
  });

  it("dedupes repeated tokens while preserving first-occurrence order", () => {
    expect(tokenizeQuery("morocco morocco trekinetic")).toEqual([
      "morocco",
      "trekinetic",
    ]);
  });

  it("keeps non-Latin script tokens", () => {
    // Hebrew word for 'wheelchair' — corpus mixes languages, so the tokenizer
    // must not drop these.
    const tokens = tokenizeQuery("עגלה");
    expect(tokens).toContain("עגלה");
  });
});
