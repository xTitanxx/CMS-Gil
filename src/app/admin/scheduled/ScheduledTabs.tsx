"use client";

import { useEffect, useState } from "react";
import { CalendarDays, LayoutList, List } from "lucide-react";
import { ContentCalendar } from "./ContentCalendar";
import { ScheduledListView } from "./ScheduledListView";
import { PlannerPanel } from "../_shared/PlannerPanel";
import { SegmentedControl } from "../_shared/SegmentedControl";

type Mode = "list" | "calendar" | "planner";

const STORAGE_KEY = "scheduledTabMode";

const MODE_OPTIONS = [
  { id: "list" as const, label: "List", icon: List },
  { id: "calendar" as const, label: "Calendar", icon: CalendarDays },
  { id: "planner" as const, label: "Planner", icon: LayoutList },
];

const HEADER: Record<Mode, { title: string; subtitle: string }> = {
  list: { title: "Scheduled", subtitle: "Upcoming queue" },
  calendar: { title: "Content Calendar", subtitle: "Scheduled and published posts" },
  planner: { title: "Planner", subtitle: "Plan and approve upcoming posts" },
};

export function ScheduledTabs() {
  const [mode, setMode] = useState<Mode>("list");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "list" || stored === "calendar" || stored === "planner") setMode(stored);
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

  const header = HEADER[mode];

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="hidden text-2xl font-bold text-gray-900 md:block">{header.title}</h1>
          <p className="text-sm text-gray-500">{header.subtitle}</p>
        </div>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={setModeAndPersist}
          ariaLabel="View mode"
          className="ml-auto"
        />
      </div>
      <div className="min-h-0 flex-1">
        {mode === "list" && <ScheduledListView />}
        {mode === "calendar" && <ContentCalendar />}
        {mode === "planner" && <PlannerPanel />}
      </div>
    </div>
  );
}
