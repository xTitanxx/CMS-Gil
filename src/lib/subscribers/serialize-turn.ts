// Per-subscriber in-flight guard. Two parallel chat turns from the same
// subscriber would both pass the budget check (read-then-stream-then-record
// has a wide race window) and stream concurrently, blowing past the cap.
// Reject the second one with 429 instead of queuing — the user gets honest
// feedback and the budget stays intact.
//
// In-memory per-instance: with Vercel Fluid Compute, a single subscriber's
// active turns will typically reuse the same warm instance, so the same Map
// catches them. Cross-instance parallel turns (rare in practice) slip through
// — that's the trade-off vs. spinning up a Postgres-backed lock service.

const inFlight = new Set<string>();

export function tryAcquireSubscriberTurn(subscriberId: string): boolean {
  if (inFlight.has(subscriberId)) return false;
  inFlight.add(subscriberId);
  return true;
}

export function releaseSubscriberTurn(subscriberId: string): void {
  inFlight.delete(subscriberId);
}
