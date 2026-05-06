"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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

type TypeFilter = "proposed" | "scheduled" | "posted" | "imported";

const ALL_TYPES: TypeFilter[] = ["proposed", "scheduled", "posted", "imported"];

const TYPE_LABEL: Record<TypeFilter, string> = {
  proposed: "Proposed",
  scheduled: "Scheduled",
  posted: "Posted",
  imported: "Imported",
};

const TYPE_COLOR: Record<TypeFilter, string> = {
  proposed: "border-gray-400 bg-white text-gray-600",
  scheduled: "border-yellow-300 bg-yellow-50 text-yellow-800",
  posted: "border-green-300 bg-green-50 text-green-800",
  imported: "border-gray-300 bg-gray-100 text-gray-700",
};

function statusToType(status: CalendarEntry["status"]): TypeFilter {
  if (status === "PROPOSED" || status === "PLAN_APPROVED") return "proposed";
  if (status === "PENDING") return "scheduled";
  if (status === "PUBLISHED") return "posted";
  return "imported";
}

export function ContentCalendar() {
  const [view, setView] = useState<"month" | "week">("week");
  const [cursor, setCursor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTypes, setActiveTypes] = useState<Set<TypeFilter>>(
    () => new Set(ALL_TYPES),
  );

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

  const visibleEntries = useMemo(
    () => entries.filter((e) => activeTypes.has(statusToType(e.status))),
    [entries, activeTypes],
  );

  function toggleType(t: TypeFilter) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-base font-semibold min-w-0 truncate text-center sm:w-44">
              {periodLabel()}
            </span>
            <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex shrink-0 rounded-lg border border-gray-200 overflow-hidden">
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

        {/* Type filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_TYPES.map((t) => {
            const on = activeTypes.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleType(t)}
                aria-pressed={on}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  on
                    ? TYPE_COLOR[t]
                    : "border-gray-200 bg-white text-gray-400 hover:border-gray-300 hover:text-gray-600"
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            );
          })}
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
              entries={visibleEntries}
              onDayClick={setSelectedDay}
              selectedDay={selectedDay}
            />
          ) : (
            <WeekView
              cursor={cursor}
              entries={visibleEntries}
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
          entries={visibleEntries.filter(
            (e) => e.date === format(selectedDay, "yyyy-MM-dd")
          )}
          onClose={() => setSelectedDay(null)}
          onScheduled={fetchEntries}
        />
      )}
    </div>
  );
}
