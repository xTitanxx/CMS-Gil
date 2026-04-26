// Pure constants — safe to import from client components. Kept separate from
// `fixed-slots.ts` (which imports Prisma) so client bundles don't pull `pg`/`tls`
// through the import graph.
export const FIXED_SLOT_HOURS = [12, 15, 18, 21] as const;
export const SCHEDULE_TZ = "Asia/Jerusalem";
