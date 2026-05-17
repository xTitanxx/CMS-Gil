import type { Prisma } from "@prisma/client";

/**
 * The single source of truth for what the suggester considers eligible and
 * how the queue is ordered. The same filter feeds:
 *   - /api/planner/next-candidate (one-card suggester at /admin/suggest)
 *   - the "Suggester queue" sort on /admin/posts (sort=queue_asc)
 *
 * Order: least-recycled first (publishCount asc), then oldest first
 * (originalDate asc). A post that gets actually published has its publishCount
 * incremented, which sinks it to the back behind all less-recycled posts —
 * exactly the "send-to-back, don't remove" behavior the suggester needs.
 */
export function getSuggesterCandidateWhere(userId: string): Prisma.PostWhereInput {
  return {
    userId,
    // Only exclude posts that have been judged unfit (NOT_READY) or actively
    // hidden from rotation (ARCHIVED). UNCHECKED posts surface so they can be
    // triaged in-context; everything else flows through.
    readiness: { notIn: ["NOT_READY", "ARCHIVED"] },
    // Don't re-suggest a post that's already on the calendar. Re-suggesting
    // would let the user double-book the same post into two slots or fire an
    // immediate publish on top of a scheduled one.
    publishes: { none: { status: { in: ["PENDING", "PROCESSING"] } } },
    planSlots: { none: { status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] } } },
  };
}

export const SUGGESTER_ORDER_BY: Prisma.PostOrderByWithRelationInput[] = [
  { publishCount: "asc" },
  { originalDate: "asc" },
  { id: "asc" },
];
