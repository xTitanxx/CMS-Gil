import { describe, expect, it } from "vitest";
import { deriveTitle } from "./youtube";

describe("deriveTitle", () => {
  it("returns the first sentence when it fits", () => {
    const body =
      "Breathwork can cut through brain fog and deliver an instant energy boost. We all know sleep, hydration, and good nutrition fuel our energy.";
    expect(deriveTitle(body)).toBe(
      "Breathwork can cut through brain fog and deliver an instant energy boost.",
    );
  });

  it("returns the whole body when there is no sentence terminator and it fits", () => {
    expect(deriveTitle("Today was a good day")).toBe("Today was a good day");
  });

  it("breaks at the first line when no sentence terminator is present", () => {
    expect(deriveTitle("First line\nSecond line")).toBe("First line");
  });

  it("word-boundary truncates when the first sentence is too long", () => {
    const body =
      "This is a really really really really really really really long single sentence without punctuation that goes past one hundred characters.";
    const title = deriveTitle(body, 100);
    expect(title.length).toBeLessThanOrEqual(100);
    expect(title.endsWith("...")).toBe(true);
    expect(title).not.toMatch(/\s\.\.\./); // no trailing space before ellipsis
    expect(body).toContain(title.slice(0, -3).trim()); // prefix is real words
  });

  it("falls back to 'Untitled' on empty body", () => {
    expect(deriveTitle("")).toBe("Untitled");
    expect(deriveTitle("   \n  ")).toBe("Untitled");
  });

  it("does not split on a period that isn't a sentence terminator", () => {
    // "3.50" — period followed by digit, not whitespace; should not match.
    expect(deriveTitle("It costs 3.50 dollars to enter the park.")).toBe(
      "It costs 3.50 dollars to enter the park.",
    );
  });
});
