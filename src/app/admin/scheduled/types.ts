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
}
