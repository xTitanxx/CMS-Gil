import { describe, it, expect } from "vitest";
import {
  computeHaikuCost,
  startOfCurrentCycle,
  startOfNextCycle,
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

describe("startOfCurrentCycle", () => {
  it("returns this month's anniversary when today >= anniversary day", () => {
    const createdAt = new Date(Date.UTC(2026, 0, 15)); // Jan 15
    const now = new Date(Date.UTC(2026, 4, 20, 9, 30)); // May 20 09:30
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2026-05-15T00:00:00.000Z"
    );
  });

  it("returns last month's anniversary when today < anniversary day", () => {
    const createdAt = new Date(Date.UTC(2026, 0, 20)); // Jan 20
    const now = new Date(Date.UTC(2026, 4, 5, 9, 30)); // May 5 09:30
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2026-04-20T00:00:00.000Z"
    );
  });

  it("returns today when today is exactly the anniversary", () => {
    const createdAt = new Date(Date.UTC(2026, 0, 15)); // Jan 15
    const now = new Date(Date.UTC(2026, 4, 15, 0, 0)); // May 15 00:00
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2026-05-15T00:00:00.000Z"
    );
  });

  it("clamps a 31st-of-the-month subscriber to Feb 28 in a non-leap year", () => {
    const createdAt = new Date(Date.UTC(2025, 0, 31)); // Jan 31, 2025 (non-leap)
    const now = new Date(Date.UTC(2025, 1, 28, 12, 0)); // Feb 28, 2025
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2025-02-28T00:00:00.000Z"
    );
  });

  it("clamps a 31st-of-the-month subscriber to Feb 29 in a leap year", () => {
    const createdAt = new Date(Date.UTC(2024, 0, 31)); // Jan 31, 2024 (leap)
    const now = new Date(Date.UTC(2024, 1, 29, 12, 0)); // Feb 29, 2024
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2024-02-29T00:00:00.000Z"
    );
  });

  it("rolls back into prior year for January when before anniversary", () => {
    const createdAt = new Date(Date.UTC(2025, 5, 20)); // Jun 20, 2025
    const now = new Date(Date.UTC(2026, 0, 5, 12, 0)); // Jan 5, 2026
    expect(startOfCurrentCycle(createdAt, now).toISOString()).toBe(
      "2025-12-20T00:00:00.000Z"
    );
  });
});

describe("startOfNextCycle", () => {
  it("returns next month's anniversary for a mid-month subscriber", () => {
    const createdAt = new Date(Date.UTC(2026, 0, 15)); // Jan 15
    const now = new Date(Date.UTC(2026, 4, 20, 9, 30)); // May 20
    expect(startOfNextCycle(createdAt, now).toISOString()).toBe(
      "2026-06-15T00:00:00.000Z"
    );
  });

  it("clamps a Jan-31 subscriber to Feb 28 when next cycle is February", () => {
    const createdAt = new Date(Date.UTC(2025, 0, 31)); // Jan 31, 2025
    const now = new Date(Date.UTC(2025, 0, 31, 12, 0)); // Jan 31
    expect(startOfNextCycle(createdAt, now).toISOString()).toBe(
      "2025-02-28T00:00:00.000Z"
    );
  });

  it("rolls into next year when current cycle is December", () => {
    const createdAt = new Date(Date.UTC(2025, 5, 20)); // Jun 20, 2025
    const now = new Date(Date.UTC(2025, 11, 25, 12, 0)); // Dec 25, 2025
    expect(startOfNextCycle(createdAt, now).toISOString()).toBe(
      "2026-01-20T00:00:00.000Z"
    );
  });
});
