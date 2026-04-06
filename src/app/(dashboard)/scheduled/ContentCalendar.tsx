"use client";

import { useCallback, useEffect, useState } from "react";
import { addMonths, addWeeks, format, subMonths, subWeeks } from "date-fns";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayPanel } from "./DayPanel";
import { getDateRange } from "./calendar-utils";
import type { CalendarEntry } from "./types";

type CalendarView = "month" | "week";

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

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleViewChange = (newView: CalendarView) => {
    setView(newView);
  };

  const handleNavigate = (direction: "prev" | "next") => {
    if (view === "month") {
      setCursor(direction === "next" ? addMonths(cursor, 1) : subMonths(cursor, 1));
    } else {
      setCursor(direction === "next" ? addWeeks(cursor, 1) : subWeeks(cursor, 1));
    }
  };

  return (
    <div className="space-y-6">
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
        <div className="flex gap-0">
          <div className="flex-1 min-w-0">
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
          </div>
          {selectedDay !== null && (
            <DayPanel
              day={selectedDay}
              entries={entries.filter(
                (e) => e.date === format(selectedDay, "yyyy-MM-dd")
              )}
              onClose={() => setSelectedDay(null)}
              onScheduled={fetchEntries}
            />
          )}
        </div>
      )}
    </div>
  );
}

