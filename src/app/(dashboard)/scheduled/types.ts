export interface CalendarEntry {
  postId: string;
  date: string; // YYYY-MM-DD
  status: "PENDING" | "PUBLISHED" | "IMPORTED";
  platform?: string;
  thumbUrl: string | null;
  body: string;
}
