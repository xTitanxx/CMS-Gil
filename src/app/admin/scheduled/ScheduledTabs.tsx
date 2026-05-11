"use client";

import { useEffect, useState } from "react";
import { CalendarDays, LayoutList } from "lucide-react";
import { ContentCalendar } from "./ContentCalendar";
import { PlannerPanel } from "../_shared/PlannerPanel";
import { SegmentedControl } from "../_shared/SegmentedControl";

type Mode = "calendar" | "planner";

const STORAGE_KEY = "scheduledTabMode";

const MODE_OPTIONS = [
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "planner" as const, label: "Planner", icon: LayoutList },
];

export function ScheduledTabs() {
  const [mode, setMode] = useState<Mode>("calendar");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "calendar" || stored === "planner") setMode(stored);
    } catch {
      // ignore localStorage failures (private mode etc.)
    }
  }, []);

  function setModeAndPersist(next: Mode) {
    setMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {mode === "calendar" ? (
          <div className="min-w-0">
            <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Content Calendar</h1>
            <p className="text-sm text-gray-500">Scheduled and published posts</p>
          </div>
        ) : (
          <div className="min-w-0">
            <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Planner</h1>
            <p className="text-sm text-gray-500">Plan and approve upcoming posts</p>
          </div>
        )}
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setModeAndPersist}
          ariaLabel="View mode"
          className="ml-auto"
        />
      </div>
      <div className="min-h-0 flex-1">
        {mode === "calendar" ? <ContentCalendar /> : <PlannerPanel />}
      </div>
    </div>
  );
}
