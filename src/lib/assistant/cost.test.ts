import { describe, it, expect } from "vitest";
import { priceForUsage } from "./cost";

describe("priceForUsage", () => {
  it("computes Sonnet 4.6 cost from full usage breakdown", () => {
    const cost = priceForUsage("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 500_000,
    });
    // 1M*$3 + 0.1M*$15 + 0.2M*$3.75 + 0.5M*$0.30 = 3 + 1.5 + 0.75 + 0.15 = $5.40
    expect(cost).toBeCloseTo(5.4, 6);
  });

  it("treats missing cache fields as zero", () => {
    const cost = priceForUsage("claude-sonnet-4-6", {
      input_tokens: 1_000,
      output_tokens: 1_000,
    });
    // 1k*$3 + 1k*$15 = (3 + 15)/1000 = $0.018
    expect(cost).toBeCloseTo(0.018, 6);
  });

  it("uses Haiku pricing when model is haiku-4-5", () => {
    const cost = priceForUsage("claude-haiku-4-5-20251001", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
    });
    // 1M*$1 + 0.1M*$5 = 1 + 0.5 = $1.50
    expect(cost).toBeCloseTo(1.5, 6);
  });

  it("falls back to Sonnet pricing for unknown models", () => {
    const cost = priceForUsage("some-unknown-model", {
      input_tokens: 1_000,
      output_tokens: 0,
    });
    expect(cost).toBeCloseTo(0.003, 6);
  });

  it("returns 0 for zero usage", () => {
    const cost = priceForUsage("claude-sonnet-4-6", {
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});
