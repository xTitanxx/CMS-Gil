"use client";

import { format } from "date-fns";

interface DayHeaderProps {
  day: Date;
  isToday: boolean;
  slotCount: number;
}

export function DayHeader({ day, isToday, slotCount }: DayHeaderProps) {
  const label = isToday
    ? `Today, ${format(day, "MMM d")}`
    : format(day, "EEE, MMM d");

  return (
    <div
      className={`sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-1 py-2 backdrop-blur-sm ${
        isToday ? "border-blue-200" : "border-gray-100"
      }`}
    >
      <span
        className={`text-[13px] font-semibold uppercase tracking-wide ${
          isToday ? "text-blue-600" : "text-gray-500"
        }`}
      >
        {label}
      </span>
      {slotCount > 0 && (
        <span className="text-[11px] text-gray-400">
          {slotCount} {slotCount === 1 ? "post" : "posts"}
        </span>
      )}
    </div>
  );
}
