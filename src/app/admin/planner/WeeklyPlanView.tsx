"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarDays, Sparkles, CalendarCheck, Loader2, Trash2, Recycle, Layers, Minus, Plus } from "lucide-react";
import Link from "next/link";
import { format } from "date-fns";
import { utcDateString } from "@/lib/planner/week";
import { DayGroup } from "./DayGroup";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

const DAY_MS = 86400000;
const INITIAL_FUTURE = 10;
const LOAD_MORE = 7;

type LoadingAction = "AI" | "DUMB" | "clear" | "schedule" | null;

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  onGenerate: (preferences?: string, mode?: "AI" | "DUMB", numSlots?: number) => Promise<void>;
  onApproveSlot: (slotId: string) => Promise<void>;
  onRemoveSlot: (slotId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onScheduleAll: () => Promise<void>;
  /** @deprecated unused — retained for compatibility */
  onSwapSlot?: (slotId: string) => void;
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
  onGenerate,
  onApproveSlot,
  onRemoveSlot,
  onClearAll,
  onScheduleAll,
}: WeeklyPlanViewProps) {
  const [activeAction, setActiveAction] = useState<LoadingAction>(null);
  const [futureDays, setFutureDays] = useState(INITIAL_FUTURE);
  const days = buildDayRange(futureDays);
  const todayKey = utcDateString(todayUTC());

  // Slot-count prompt state
  const [pendingMode, setPendingMode] = useState<"AI" | "DUMB" | null>(null);
  const [slotCount, setSlotCount] = useState(7);

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
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleGenerateConfirm = useCallback(async () => {
    if (!pendingMode) return;
    const mode = pendingMode;
    const slots = slotCount;
    setPendingMode(null);
    setActiveAction(mode);
    await onGenerate(undefined, mode, slots);
    setActiveAction(null);
  }, [pendingMode, slotCount, onGenerate]);

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

        {/* Action grid — two equal-width buttons fit cleanly on narrow screens.
            For deeper planning flows (one-by-one, presets), the dedicated
            Suggester tab handles the cramped UI better. */}
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button
            onClick={() => { setPendingMode("DUMB"); setSlotCount(7); }}
            disabled={loading || pendingMode !== null}
            size="sm"
            variant="outline"
            className="h-10 justify-center gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 sm:h-9"
            title="Fill slots with the oldest unpublished posts (no AI)"
          >
            {activeAction === "DUMB" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Recycle className="h-4 w-4" />}
            <span>Recycle</span>
          </Button>
          <Button
            onClick={() => { setPendingMode("AI"); setSlotCount(7); }}
            disabled={loading || pendingMode !== null}
            size="sm"
            className="h-10 justify-center gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60 sm:h-9"
          >
            {activeAction === "AI" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>AI plan</span>
          </Button>
          <Link
            href="/admin/suggest"
            className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:col-span-1 sm:h-9"
          >
            <Layers className="h-4 w-4" />
            <span>One by one</span>
          </Link>
          {proposedSlots.length > 0 && (
            <Button
              onClick={async () => {
                setActiveAction("clear");
                await onClearAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              variant="outline"
              className="h-10 justify-center gap-1.5 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60 sm:h-9"
            >
              {activeAction === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span>Clear</span>
            </Button>
          )}
          {activeSlots.length > 0 && (
            <Button
              onClick={async () => {
                setActiveAction("schedule");
                await onScheduleAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              className="col-span-2 h-10 justify-center gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 sm:col-span-1 sm:ml-auto sm:h-9"
            >
              {activeAction === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              <span>Approve all ({activeSlots.length})</span>
            </Button>
          )}
        </div>

        {/* Slot-count prompt — stacks comfortably on mobile widths. */}
        {pendingMode !== null && (
          <div className="mt-2.5 rounded-xl border border-gray-200 bg-gray-50 p-2.5">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
              How many slots?
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSlotCount((c) => Math.max(1, c - 1))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                aria-label="Decrease"
              >
                <Minus className="h-4 w-4" />
              </button>
              <input
                type="number"
                min={1}
                max={56}
                value={slotCount}
                onChange={(e) =>
                  setSlotCount(Math.max(1, Math.min(56, Number(e.target.value))))
                }
                className="h-10 w-20 rounded-lg border border-gray-300 bg-white px-2 text-center text-base font-semibold focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleGenerateConfirm();
                  if (e.key === "Escape") setPendingMode(null);
                }}
              />
              <button
                type="button"
                onClick={() => setSlotCount((c) => Math.min(56, c + 1))}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
                aria-label="Increase"
              >
                <Plus className="h-4 w-4" />
              </button>
              <span className="ml-1 text-[10px] leading-tight text-gray-400">
                4 = 1 day<br />28 = 7 days
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPendingMode(null)}
                className="h-10 text-gray-500"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleGenerateConfirm}
                className="h-10 gap-1.5 bg-purple-600 hover:bg-purple-700"
              >
                Go
              </Button>
            </div>
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
          <div className="space-y-5">
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
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-4" />
          </div>
        )}
      </div>
    </div>
  );
}
