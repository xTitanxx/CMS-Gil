"use client";

import { DayHeader } from "./DayHeader";
import { PlanSlotCard } from "./PlanSlotCard";
import { EmptyDayRow } from "./EmptyDayRow";
import { utcDateString } from "@/lib/planner/week";
import type { PlanSlotData } from "@/lib/planner/types";

interface DayGroupProps {
  day: Date;
  isToday: boolean;
  slots: PlanSlotData[];
  onApprove: (slotId: string) => void;
  onRemove: (slotId: string) => void;
  onSwap: (slotId: string) => void;
}

export function DayGroup({ day, isToday, slots, onApprove, onRemove, onSwap }: DayGroupProps) {
  const dayKey = utcDateString(day);

  const statusOrder: Record<string, number> = { PROPOSED: 0, APPROVED: 1, SCHEDULED: 2, SKIPPED: 3 };
  const sorted = [...slots].sort((a, b) => {
    if (a.post.hasVideo !== b.post.hasVideo) return a.post.hasVideo ? -1 : 1;
    return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
  });

  const approvable = slots.filter((s) => s.status === "PROPOSED" || s.status === "APPROVED");

  return (
    <div>
      <DayHeader
        day={day}
        isToday={isToday}
        slotCount={slots.length}
        slots={slots}
        onApproveAll={approvable.length > 0 ? () => approvable.forEach((s) => onApprove(s.id)) : undefined}
      />
      <div className="mt-3 space-y-3">
        {sorted.length === 0 ? (
          <EmptyDayRow dayKey={dayKey} />
        ) : (
          sorted.map((slot, i) => (
            <PlanSlotCard
              key={slot.id}
              slot={slot}
              onApprove={onApprove}
              onRemove={onRemove}
              onSwap={onSwap}
              isLast={i === sorted.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
