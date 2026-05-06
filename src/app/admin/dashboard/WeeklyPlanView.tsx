"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarDays, Sparkles, CalendarCheck, Loader2, ChevronUp, ChevronDown, Trash2, Recycle } from "lucide-react";
import { format } from "date-fns";
import { utcDateString } from "@/lib/planner/week";
import { DayGroup } from "./DayGroup";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

const DAY_MS = 86400000;
const INITIAL_PAST = 3;
const INITIAL_FUTURE = 10;
const LOAD_MORE = 7;

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  onGenerate: (preferences?: string, mode?: "AI" | "DUMB") => Promise<void>;
  onApproveSlot: (slotId: string) => Promise<void>;
  onRemoveSlot: (slotId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onScheduleAll: () => Promise<void>;
  /** @deprecated unused — retained for compatibility with assistant PlannerPanel until that's updated. */
  onSwapSlot?: (slotId: string) => void;
}

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function buildDayRange(pastDays: number, futureDays: number): Date[] {
  const base = todayUTC();
  const days: Date[] = [];
  for (let i = -pastDays; i <= futureDays; i++) {
    days.push(new Date(base.getTime() + i * DAY_MS));
  }
  return days;
}

export function WeeklyPlanView({
  plan,
  loading,
  onGenerate,
  onApproveSlot,
  onRemoveSlot,
  onClearAll,
  onScheduleAll,
}: WeeklyPlanViewProps) {
  const [pastDays, setPastDays] = useState(INITIAL_PAST);
  const [futureDays, setFutureDays] = useState(INITIAL_FUTURE);
  const days = buildDayRange(pastDays, futureDays);
  const todayKey = utcDateString(todayUTC());

  // Build slot lookup — multiple slots per day
  const slotsByDay = new Map<string, PlanSlotData[]>();
  if (plan) {
    for (const slot of plan.slots) {
      const arr = slotsByDay.get(slot.day) ?? [];
      arr.push(slot);
      slotsByDay.set(slot.day, arr);
    }
  }

  const proposedSlots = plan?.slots.filter((s) => s.status === "PROPOSED") ?? [];
  const activeSlots = plan?.slots.filter(
    (s) => s.status === "PROPOSED" || s.status === "APPROVED"
  ) ?? [];

  // Scroll to today on mount
  const todayRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  useEffect(() => {
    if (!didScroll.current && todayRef.current) {
      todayRef.current.scrollIntoView({ block: "start" });
      didScroll.current = true;
    }
  });

  const loadEarlier = useCallback(() => {
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setPastDays((d) => d + LOAD_MORE);
    requestAnimationFrame(() => {
      if (el) el.scrollTop += el.scrollHeight - prevHeight;
    });
  }, []);

  const loadLater = useCallback(() => {
    setFutureDays((d) => d + LOAD_MORE);
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays className="h-5 w-5 shrink-0 text-gray-500" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Planner</h2>
              {plan?.mode === "DUMB" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <Recycle className="h-3 w-3" />
                  Recycle queue
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-gray-400">
              {format(days[0], "MMM d")} – {format(days[days.length - 1], "MMM d")}
            </p>
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-2">
          {proposedSlots.length > 0 && (
            <Button
              onClick={onClearAll}
              disabled={loading}
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Clear All</span>
            </Button>
          )}
          <Button
            onClick={() => onGenerate(undefined, "DUMB")}
            disabled={loading}
            size="sm"
            variant="outline"
            className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            title="Fill the week with the oldest unpublished posts (no AI)"
          >
            <Recycle className="h-4 w-4" />
            <span className="hidden sm:inline">Recycle Oldest</span>
            <span className="sm:hidden">Recycle</span>
          </Button>
          <Button
            onClick={() => onGenerate()}
            disabled={loading}
            size="sm"
            className="gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">Plan My Week</span>
            <span className="sm:hidden">Plan</span>
          </Button>
        </div>
      </div>

      {/* Day list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {loading && !plan ? (
          <div className="flex h-40 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Generating plan…</span>
          </div>
        ) : (
          <div className="space-y-5">
            <button
              onClick={loadEarlier}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-1.5 text-[11px] text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
            >
              <ChevronUp className="h-3 w-3" /> Earlier
            </button>

            {days.map((day) => {
              const dayKey = utcDateString(day);
              const isToday = dayKey === todayKey;
              return (
                <div key={dayKey} ref={isToday ? todayRef : undefined}>
                  <DayGroup
                    day={day}
                    isToday={isToday}
                    slots={slotsByDay.get(dayKey) ?? []}
                    onApprove={onApproveSlot}
                    onRemove={onRemoveSlot}
                  />
                </div>
              );
            })}

            <button
              onClick={loadLater}
              className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 py-1.5 text-[11px] text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
            >
              <ChevronDown className="h-3 w-3" /> Later
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      {activeSlots.length > 0 && (
        <div className="border-t border-gray-100 px-4 py-2.5">
          <Button
            onClick={onScheduleAll}
            disabled={loading}
            className="w-full gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60"
            size="sm"
          >
            <CalendarCheck className="h-4 w-4" />
            Approve &amp; Schedule All ({activeSlots.length})
          </Button>
        </div>
      )}
    </div>
  );
}
