"use client";

import { useState, useEffect, useCallback } from "react";
import {
  format,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  addDays,
  isSameMonth,
  isSameWeek,
  startOfDay,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MonthView } from "./MonthView";
import { WeekView } from "./WeekView";
import { DayPanel } from "./DayPanel";
import { getGridDays, getDateRange } from "./calendar-utils";
import type { CalendarEntry } from "./types";

export function ContentCalendar() {
  const [view, setView] = useState<"month" | "week">("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const { start, end } = getDateRange(view, cursor);
    const params = new URLSearchParams({
      start: format(start, "yyyy-MM-dd"),
      end: format(end, "yyyy-MM-dd"),
    });
    const res = await fetch(`/api/calendar?${params}`);
    const data = await res.json();
    setEntries(data.entries ?? []);
    setLoading(false);
  }, [view, cursor]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function navigate(dir: 1 | -1) {
    setCursor((c) =>
      view === "month"
        ? dir === 1 ? addMonths(c, 1) : subMonths(c, 1)
        : dir === 1 ? addWeeks(c, 1) : subWeeks(c, 1)
    );
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      const key = e.key;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "ArrowUp" &&
        key !== "ArrowDown"
      ) {
        return;
      }
      e.preventDefault();
      const delta =
        key === "ArrowLeft"
          ? -1
          : key === "ArrowRight"
            ? 1
            : key === "ArrowUp"
              ? -7
              : 7;
      setSelectedDay((prev) => {
        const base = prev ?? startOfDay(cursor);
        const next = addDays(base, delta);
        // Keep cursor in sync so the grid follows the selection
        if (view === "month") {
          if (!isSameMonth(next, cursor)) setCursor(next);
        } else {
          if (!isSameWeek(next, cursor)) setCursor(next);
        }
        return next;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, cursor]);

  function periodLabel() {
    if (view === "month") return format(cursor, "MMMM yyyy");
    const days = getGridDays("week", cursor);
    const start = days[0];
    const end = days[6];
    return format(start, "MMM d") + "–" + format(end, "d, yyyy");
  }

  return (
    <div className="flex h-full gap-0">
      {/* Calendar area */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-base font-semibold w-44 text-center">
              {periodLabel()}
            </span>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setView("month")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "month"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setView("week")}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                view === "week"
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              Week
            </button>
          </div>
        </div>

        {/* Grid */}
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60">
              <Spinner className="h-6 w-6 text-gray-400" />
            </div>
          )}
          {view === "month" ? (
            <MonthView
              cursor={cursor}
              entries={entries}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          ) : (
            <WeekView
              cursor={cursor}
              entries={entries}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          )}
        </div>
      </div>

      {/* Day panel */}
      {selectedDay && (
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
  );
}
