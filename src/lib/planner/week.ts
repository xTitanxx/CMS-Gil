/**
 * Returns the Monday of the current week as a UTC midnight Date.
 * Safe to call on server (UTC) or client (any timezone) — always gives the same result.
 */
export function getMondayUTC(from: Date = new Date()): Date {
  const day = from.getUTCDay(); // 0=Sun, 1=Mon … 6=Sat
  const daysToMonday = day === 0 ? -6 : 1 - day;
  return new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + daysToMonday,
    )
  );
}

/** Format a UTC-midnight Date as "yyyy-MM-dd" using UTC parts — never goes through local timezone. */
export function utcDateString(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
