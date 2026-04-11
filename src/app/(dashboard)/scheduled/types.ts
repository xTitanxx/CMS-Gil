export interface CalendarEntry {
  postId: string;
  date: string; // YYYY-MM-DD
  status: "PENDING" | "PUBLISHED" | "IMPORTED";
  platforms: string[]; // empty for IMPORTED
  thumbUrl: string | null;
  body: string;
}
