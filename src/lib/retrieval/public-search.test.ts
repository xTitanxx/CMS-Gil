import { describe, it, expect } from "vitest";
import { reciprocalRankFusion } from "./public-search";

describe("reciprocalRankFusion", () => {
  it("returns empty array for empty input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it("returns single list in rank order", () => {
    const list = [
      { id: "a", rank: 0 },
      { id: "b", rank: 1 },
      { id: "c", rank: 2 },
    ];
    expect(reciprocalRankFusion([list])).toEqual(["a", "b", "c"]);
  });

  it("promotes ids that appear in multiple lists", () => {
    const vector = [{ id: "a", rank: 0 }, { id: "b", rank: 1 }];
    const phrase = [{ id: "b", rank: 0 }, { id: "c", rank: 1 }];
    const result = reciprocalRankFusion([vector, phrase]);
    expect(result[0]).toBe("b");
  });

  it("deduplicates ids that appear in both lists", () => {
    const list = [{ id: "x", rank: 0 }];
    const result = reciprocalRankFusion([list, list]);
    expect(result).toEqual(["x"]);
  });
});
