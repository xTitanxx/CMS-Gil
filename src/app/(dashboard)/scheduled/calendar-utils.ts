import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
} from "date-fns";
import type { CalendarEntry } from "./types";

export function getGridDays(view: "month" | "week", cursor: Date): Date[] {
  if (view === "week") {
    return eachDayOfInterval({
      start: startOfWeek(cursor),
      end: endOfWeek(cursor),
    });
  }
  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  return eachDayOfInterval({
    start: startOfWeek(monthStart),
    end: endOfWeek(monthEnd),
  });
}

export function getDateRange(
  view: "month" | "week",
  cursor: Date
): { start: Date; end: Date } {
  const days = getGridDays(view, cursor);
  return { start: days[0], end: days[days.length - 1] };
}

export function groupEntriesByDate(
  entries: CalendarEntry[]
): Record<string, CalendarEntry[]> {
  return entries.reduce(
    (acc, entry) => {
      if (!acc[entry.date]) acc[entry.date] = [];
      acc[entry.date].push(entry);
      return acc;
    },
    {} as Record<string, CalendarEntry[]>
  );
}
