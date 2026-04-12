interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export function createRateLimiter({ maxRequests, windowMs }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;

      const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= maxRequests) {
        const oldestInWindow = timestamps[0];
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: oldestInWindow + windowMs - now,
        };
      }

      timestamps.push(now);
      hits.set(key, timestamps);

      return {
        allowed: true,
        remaining: maxRequests - timestamps.length,
      };
    },
  };
}
