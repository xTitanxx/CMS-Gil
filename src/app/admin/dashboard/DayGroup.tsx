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

  // Sort: video first, then by status (PROPOSED before APPROVED before SCHEDULED)
  const statusOrder: Record<string, number> = { PROPOSED: 0, APPROVED: 1, SCHEDULED: 2, SKIPPED: 3 };
  const sorted = [...slots].sort((a, b) => {
    if (a.post.hasVideo !== b.post.hasVideo) return a.post.hasVideo ? -1 : 1;
    return (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
  });

  return (
    <div>
      <DayHeader day={day} isToday={isToday} slotCount={slots.length} />
      <div className="space-y-2.5 py-2">
        {sorted.length === 0 ? (
          <EmptyDayRow dayKey={dayKey} />
        ) : (
          sorted.map((slot) => (
            <PlanSlotCard
              key={slot.id}
              slot={slot}
              onApprove={onApprove}
              onRemove={onRemove}
              onSwap={onSwap}
            />
          ))
        )}
      </div>
    </div>
  );
}
