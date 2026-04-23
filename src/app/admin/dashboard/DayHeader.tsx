"use client";

import { format } from "date-fns";
import type { PlanSlotData } from "@/lib/planner/types";

interface DayHeaderProps {
  day: Date;
  isToday: boolean;
  slotCount: number;
  slots: PlanSlotData[];
  onApproveAll?: () => void;
}

export function DayHeader({ day, isToday, slots, onApproveAll }: DayHeaderProps) {
  const label = isToday
    ? `Today, ${format(day, "MMM d")}`
    : format(day, "EEEE, MMM d");

  const scheduled = slots.filter((s) => s.status === "SCHEDULED").length;
  const proposed = slots.filter((s) => s.status === "PROPOSED" || s.status === "APPROVED").length;
  const total = slots.length;

  const parts: string[] = [];
  if (total > 0) parts.push(`${total} post${total !== 1 ? "s" : ""}`);
  if (scheduled > 0) parts.push(`${scheduled} scheduled`);
  if (proposed > 0) parts.push(`${proposed} proposed`);

  return (
    <div className="flex items-center justify-between border-b border-[#eae7df] pb-2">
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold leading-tight text-[#161513]">{label}</h3>
        {parts.length > 0 && (
          <p className="mt-0.5 text-[12px] text-[#7a7870]">{parts.join(" \u00b7 ")}</p>
        )}
      </div>
      {proposed > 0 && onApproveAll && (
        <button
          onClick={onApproveAll}
          className="shrink-0 rounded-full bg-[#161513] px-3.5 py-1.5 text-[12px] font-medium text-white hover:opacity-80"
        >
          Approve all
        </button>
      )}
    </div>
  );
}
