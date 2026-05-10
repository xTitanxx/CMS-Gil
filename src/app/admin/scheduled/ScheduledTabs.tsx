"use client";

import { useEffect, useState } from "react";
import { ContentCalendar } from "./ContentCalendar";
import { PlannerPanel } from "../_shared/PlannerPanel";

type Mode = "calendar" | "planner";

const STORAGE_KEY = "scheduledTabMode";

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
        <div className="ml-auto flex shrink-0 overflow-hidden rounded-lg border border-gray-200">
          <button
            type="button"
            onClick={() => setModeAndPersist("calendar")}
            aria-pressed={mode === "calendar"}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "calendar"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setModeAndPersist("planner")}
            aria-pressed={mode === "planner"}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === "planner"
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            Planner
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === "calendar" ? <ContentCalendar /> : <PlannerPanel />}
      </div>
    </div>
  );
}
