"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarDays, CalendarCheck, Loader2, Trash2, Recycle } from "lucide-react";
import { format } from "date-fns";
import { utcDateString } from "@/lib/planner/week";
import { DayGroup } from "./DayGroup";
import { EmptyDayPill } from "./EmptyDayPill";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

const DAY_MS = 86400000;
const INITIAL_FUTURE = 10;
const LOAD_MORE = 7;

type LoadingAction = "clear" | "schedule" | null;

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  /** Per-slot Schedule action (flips PROPOSED → SCHEDULED via /schedule endpoint). */
  onScheduleSlot: (slotId: string) => Promise<void>;
  /** Per-slot Unschedule action (cancels publish + removes from plan). */
  onUnscheduleSlot: (slotId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onScheduleAll: () => Promise<void>;
  /** Inline caption editor calls this so the parent can update its cached plan state. */
  onBodyChange: (postId: string, body: string) => void;
}

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function buildDayRange(futureDays: number): Date[] {
  const base = todayUTC();
  const days: Date[] = [];
  for (let i = 0; i <= futureDays; i++) {
    days.push(new Date(base.getTime() + i * DAY_MS));
  }
  return days;
}

export function WeeklyPlanView({
  plan,
  loading,
  onScheduleSlot,
  onUnscheduleSlot,
  onClearAll,
  onScheduleAll,
  onBodyChange,
}: WeeklyPlanViewProps) {
  const [activeAction, setActiveAction] = useState<LoadingAction>(null);
  const [futureDays, setFutureDays] = useState(INITIAL_FUTURE);
  const days = buildDayRange(futureDays);
  const todayKey = utcDateString(todayUTC());

  // Slots grouped by UTC day-string. Past days (yesterday and earlier) are
  // dropped entirely — the post-first view is for "what's going public", not
  // history.
  const slotsByDay = new Map<string, PlanSlotData[]>();
  if (plan) {
    for (const slot of plan.slots) {
      if (slot.day < todayKey) continue;
      const arr = slotsByDay.get(slot.day) ?? [];
      arr.push(slot);
      slotsByDay.set(slot.day, arr);
    }
  }

  const activeSlots = plan?.slots.filter(
    (s) => s.status === "PROPOSED" || s.status === "APPROVED",
  ) ?? [];

  // Scroll to today on mount
  const todayRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  useEffect(() => {
    if (!didScroll.current && todayRef.current) {
      todayRef.current.scrollIntoView({ block: "start" });
      didScroll.current = true;
    }
  });

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setFutureDays((d) => d + LOAD_MORE);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
        <div className="mb-2.5 flex items-center gap-2">
          <CalendarDays className="h-5 w-5 shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
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

        {/* Plan generation lives in the Assistant; this toolbar only exposes
            clear/schedule actions on the existing plan. */}
        {activeSlots.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={async () => {
                setActiveAction("clear");
                await onClearAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              variant="outline"
              className="h-10 min-w-0 justify-center gap-1.5 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 sm:h-9"
            >
              {activeAction === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span className="truncate">Clear all</span>
            </Button>
            <Button
              onClick={async () => {
                setActiveAction("schedule");
                await onScheduleAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              className="h-10 min-w-0 justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 sm:ml-auto sm:h-9"
            >
              {activeAction === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              <span className="truncate">Schedule all ({activeSlots.length})</span>
            </Button>
          </div>
        )}
      </div>

      {/* Day list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && !plan ? (
          <div className="flex h-40 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Generating plan…</span>
          </div>
        ) : (
          <div className="space-y-4">
            {days.map((day) => {
              const dayKey = utcDateString(day);
              const isToday = dayKey === todayKey;
              const daySlots = slotsByDay.get(dayKey) ?? [];
              const hasContent = daySlots.length > 0;
              return (
                <div key={dayKey} ref={isToday ? todayRef : undefined}>
                  {hasContent ? (
                    <DayGroup
                      day={day}
                      isToday={isToday}
                      slots={daySlots}
                      onUnschedule={(id) => void onUnscheduleSlot(id)}
                      onSchedule={(id) => void onScheduleSlot(id)}
                      onBodyChange={onBodyChange}
                    />
                  ) : (
                    <EmptyDayPill day={day} isToday={isToday} />
                  )}
                </div>
              );
            })}
            <div ref={sentinelRef} className="h-4" />
          </div>
        )}
      </div>
    </div>
  );
}
