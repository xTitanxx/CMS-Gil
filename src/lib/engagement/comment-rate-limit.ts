import { createRateLimiter } from "@/lib/rate-limit";

/**
 * 5 comments per subscriber per minute. In-memory; sufficient at this audience
 * scale because Fluid Compute reuses instances per region. A determined
 * subscriber whose requests get round-robined across N instances effectively
 * gets 5N/min — acceptable ceiling.
 */
export const commentRateLimiter = createRateLimiter({
  maxRequests: 5,
  windowMs: 60_000,
});
