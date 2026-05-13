export interface CalendarEntry {
  postId: string;
  date: string; // YYYY-MM-DD
  /** Display time for the entry, e.g. "12pm". Null when no time is known
   *  (e.g. IMPORTED posts without an explicit publish time). */
  time: string | null;
  status: "PENDING" | "PUBLISHED" | "IMPORTED" | "PROPOSED" | "PLAN_APPROVED";
  platforms: string[]; // empty for IMPORTED/PROPOSED/PLAN_APPROVED
  thumbUrl: string | null;
  body: string;
  /** PublishRecord ids backing this entry. Only populated for PENDING entries
   *  so DayPanel can offer per-entry cancellation. A single calendar entry
   *  groups one post + day + status across multiple platforms, so this is an
   *  array. */
  publishRecordIds?: string[];
}
