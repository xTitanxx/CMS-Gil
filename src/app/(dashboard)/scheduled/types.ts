export interface CalendarEntry {
  postId: string;
  date: string; // YYYY-MM-DD
  status: "PENDING" | "PUBLISHED" | "IMPORTED" | "PROPOSED" | "PLAN_APPROVED";
  platforms: string[]; // empty for IMPORTED/PROPOSED/PLAN_APPROVED
  thumbUrl: string | null;
  body: string;
}
