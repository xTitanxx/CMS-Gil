"use client";

import { useCallback, useState } from "react";
import { format } from "date-fns";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayPanel } from "./DayPanel";
import type { CalendarEntry } from "./types";

type CalendarView = "month" | "week" | "day";

export function ContentCalendar() {
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState(new Date());
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getDateRange(view, cursor);
      const params = new URLSearchParams({
        start: format(start, "yyyy-MM-dd"),
        end: format(end, "yyyy-MM-dd"),
      });
      const res = await fetch(`/api/calendar?${params}`);
      if (!res.ok) throw new Error(`Calendar fetch failed: ${res.status}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [view, cursor]);

  const handleViewChange = (newView: CalendarView) => {
    setView(newView);
  };

  const handleNavigate = (direction: "prev" | "next") => {
    const newCursor = new Date(cursor);
    if (view === "month") {
      newCursor.setMonth(newCursor.getMonth() + (direction === "next" ? 1 : -1));
    } else if (view === "week") {
      newCursor.setDate(newCursor.getDate() + (direction === "next" ? 7 : -7));
    } else {
      newCursor.setDate(newCursor.getDate() + (direction === "next" ? 1 : -1));
    }
    setCursor(newCursor);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
        <p className="text-sm text-gray-500">
          View and manage your scheduled posts
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => handleViewChange("month")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            view === "month"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-900 hover:bg-gray-300"
          }`}
        >
          Month
        </button>
        <button
          onClick={() => handleViewChange("week")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            view === "week"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-900 hover:bg-gray-300"
          }`}
        >
          Week
        </button>
        <button
          onClick={() => handleViewChange("day")}
          className={`px-4 py-2 rounded-lg text-sm font-medium ${
            view === "day"
              ? "bg-blue-600 text-white"
              : "bg-gray-200 text-gray-900 hover:bg-gray-300"
          }`}
        >
          Day
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={() => handleNavigate("prev")}
          className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300"
        >
          ← Previous
        </button>
        <h2 className="text-lg font-semibold text-gray-900">
          {view === "month" && format(cursor, "MMMM yyyy")}
          {view === "week" && `Week of ${format(cursor, "MMM d, yyyy")}`}
          {view === "day" && format(cursor, "MMMM d, yyyy")}
        </h2>
        <button
          onClick={() => handleNavigate("next")}
          className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300"
        >
          Next →
        </button>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : (
        <>
          {view === "month" && (
            <MonthView
              entries={entries}
              cursor={cursor}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          )}
          {view === "week" && (
            <WeekView
              entries={entries}
              cursor={cursor}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          )}
          {view === "day" && (
            <DayPanel
              day={cursor}
              entries={entries}
              onClose={() => handleViewChange("month")}
              onScheduled={fetchEntries}
            />
          )}
        </>
      )}
    </div>
  );
}

function getDateRange(
  view: CalendarView,
  cursor: Date
): { start: Date; end: Date } {
  const start = new Date(cursor);
  const end = new Date(cursor);

  if (view === "month") {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
  } else if (view === "week") {
    const day = start.getDay();
    start.setDate(start.getDate() - day);
    end.setDate(start.getDate() + 6);
  } else {
    end.setDate(end.getDate() + 1);
  }

  return { start, end };
}
