"use client";

import { Button } from "@/components/ui/button";
import { CalendarDays, Sparkles, CalendarCheck, Loader2 } from "lucide-react";
import { startOfWeek, addDays, format } from "date-fns";
import { PlanSlotRow } from "./PlanSlotRow";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  onGenerate: (preferences?: string) => Promise<void>;
  onApproveSlot: (slotId: string) => Promise<void>;
  onRemoveSlot: (slotId: string) => Promise<void>;
  onSwapSlot: (day: string) => void;
  onScheduleAll: () => Promise<void>;
}

export function WeeklyPlanView({
  plan,
  loading,
  onGenerate,
  onApproveSlot,
  onRemoveSlot,
  onSwapSlot,
  onScheduleAll,
}: WeeklyPlanViewProps) {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekRange = `${format(days[0], "MMM d")} – ${format(days[6], "MMM d, yyyy")}`;

  // Build slot lookup by day string
  const slotByDay = new Map<string, PlanSlotData>();
  if (plan) {
    for (const slot of plan.slots) {
      slotByDay.set(slot.day, slot);
    }
  }

  const activeSlots = plan?.slots.filter(
    (s) => s.status === "PROPOSED" || s.status === "APPROVED"
  ) ?? [];
  const hasSchedulable = activeSlots.length > 0;

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gray-500" />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Weekly Plan</h2>
            <p className="text-xs text-gray-500">{weekRange}</p>
          </div>
        </div>

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
          Plan My Week
        </Button>
      </div>

      {/* Slot list */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && !plan ? (
          <div className="flex h-40 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Generating plan…</span>
          </div>
        ) : (
          <div className="space-y-2">
            {days.map((day) => {
              const dayKey = format(day, "yyyy-MM-dd");
              const slot = slotByDay.get(dayKey) ?? null;
              return (
                <PlanSlotRow
                  key={dayKey}
                  day={day}
                  slot={slot}
                  onSwap={onSwapSlot}
                  onRemove={onRemoveSlot}
                  onApprove={onApproveSlot}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {hasSchedulable && (
        <div className="border-t border-gray-100 px-5 py-3">
          <Button
            onClick={onScheduleAll}
            disabled={loading}
            className="w-full gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-60"
          >
            <CalendarCheck className="h-4 w-4" />
            Approve &amp; Schedule All
          </Button>
        </div>
      )}
    </div>
  );
}
