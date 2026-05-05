import { createRateLimiter } from "@/lib/rate-limit";

// 10 attempts per IP per hour — bcrypt verify is slow, so this also throttles compute.
export const subscriberSignInLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});
