"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Loader2, Trash2 } from "lucide-react";
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
  // Anything still in the pipeline — proposed, approved, OR already scheduled
  // (PENDING PublishRecord). Once everything is SCHEDULED, activeSlots empties
  // out but the user still needs a way to wipe the queue, so the Clear button
  // keys off this wider set. Published slots are excluded — we can't un-publish.
  const clearableSlots = plan?.slots.filter(
    (s) => !s.published && (s.status === "PROPOSED" || s.status === "APPROVED" || s.status === "SCHEDULED"),
  ) ?? [];

  // Scroll today into view on mount. useLayoutEffect runs synchronously before
  // paint, so the user never sees the initial scrollTop=0 flash before we jump
  // down. Setting scrollTop on the scroll container directly (rather than
  // scrollIntoView) keeps the scroll scoped to the planner column and won't
  // bubble up to scroll the page itself.
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  useLayoutEffect(() => {
    if (didScroll.current) return;
    const container = scrollRef.current;
    const target = todayRef.current;
    if (!container || !target) return;
    container.scrollTop = target.offsetTop - container.offsetTop;
    didScroll.current = true;
  }, [plan]);

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
    <div className="flex h-full flex-col bg-white">
      {/* Toolbar — only renders when there's something to act on. The page
          header above ("Planner / Plan and approve upcoming posts") already
          identifies this surface; an inner title + date range was duplicate
          chrome, and the date range fought the infinite-scroll model. */}
      {clearableSlots.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-3 py-3 sm:px-4">
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
            <span className="truncate">Clear all ({clearableSlots.length})</span>
          </Button>
          {activeSlots.length > 0 && (
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
          )}
        </div>
      )}

      {/* Day list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
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
