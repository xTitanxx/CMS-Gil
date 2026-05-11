"use client";

import { format } from "date-fns";

interface EmptyDayPillProps {
  day: Date;
  isToday?: boolean;
}

export function EmptyDayPill({ day, isToday }: EmptyDayPillProps) {
  const label = isToday ? `Today, ${format(day, "MMM d")}` : format(day, "EEE · MMM d");
  return (
    <div className="flex items-center justify-between rounded-full border border-dashed border-gray-200 bg-white/50 px-3 py-1.5 text-[12px] text-gray-400">
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-2 shrink-0 italic">empty</span>
    </div>
  );
}
