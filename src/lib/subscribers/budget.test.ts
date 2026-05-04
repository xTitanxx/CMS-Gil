import { describe, it, expect } from "vitest";
import {
  computeHaikuCost,
  startOfCurrentMonthUtc,
  HAIKU_PRICES,
} from "./budget";

describe("computeHaikuCost", () => {
  it("returns 0 for empty usage", () => {
    expect(
      computeHaikuCost({
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      })
    ).toBe(0);
  });

  it("charges input + output at the published rates", () => {
    // 1,000,000 input @ $1 + 1,000,000 output @ $5 = $6
    const cost = computeHaikuCost({
      input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6, 6);
  });

  it("charges cache write (1h) at $2/MTok and cache read at $0.10/MTok", () => {
    // 100k cache write @ $2/M = $0.20; 100k cache read @ $0.10/M = $0.01
    const cost = computeHaikuCost({
      input_tokens: 0,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 0,
    });
    expect(cost).toBeCloseTo(0.21, 6);
  });

  it("matches a realistic Haiku cached turn ≈ $0.01", () => {
    // 90k cache read + 500 input + 400 output
    const cost = computeHaikuCost({
      input_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 90_000,
      output_tokens: 400,
    });
    expect(cost).toBeCloseTo(0.0115, 4);
  });

  it("exposes the canonical prices for documentation/tests", () => {
    expect(HAIKU_PRICES.inputPerMTok).toBe(1.0);
    expect(HAIKU_PRICES.cacheWrite1hPerMTok).toBe(2.0);
    expect(HAIKU_PRICES.cacheReadPerMTok).toBe(0.1);
    expect(HAIKU_PRICES.outputPerMTok).toBe(5.0);
  });
});

describe("startOfCurrentMonthUtc", () => {
  it("returns midnight on the 1st in UTC for a given reference date", () => {
    const ref = new Date(Date.UTC(2026, 3, 28, 14, 30, 0)); // 2026-04-28T14:30Z
    const start = startOfCurrentMonthUtc(ref);
    expect(start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("rolls into the new month on UTC midnight of the 1st", () => {
    const ref = new Date(Date.UTC(2026, 4, 1, 0, 0, 0)); // 2026-05-01T00:00Z
    const start = startOfCurrentMonthUtc(ref);
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});
