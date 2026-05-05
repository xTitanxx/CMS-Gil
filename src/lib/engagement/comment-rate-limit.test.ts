import { describe, it, expect, vi, beforeEach } from "vitest";
import { commentRateLimiter } from "./comment-rate-limit";

describe("commentRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T12:00:00Z"));
  });

  it("allows 5 in a minute, blocks the 6th", () => {
    const key = `sub-cap-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      expect(commentRateLimiter.check(key).allowed).toBe(true);
    }
    const sixth = commentRateLimiter.check(key);
    expect(sixth.allowed).toBe(false);
    expect(sixth.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window expires", () => {
    const key = `sub-reset-${Date.now()}`;
    for (let i = 0; i < 5; i++) commentRateLimiter.check(key);
    expect(commentRateLimiter.check(key).allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(commentRateLimiter.check(key).allowed).toBe(true);
  });

  it("tracks subscribers independently", () => {
    const a = `sub-a-${Date.now()}`;
    const b = `sub-b-${Date.now()}`;
    for (let i = 0; i < 5; i++) commentRateLimiter.check(a);
    expect(commentRateLimiter.check(a).allowed).toBe(false);
    expect(commentRateLimiter.check(b).allowed).toBe(true);
  });
});
