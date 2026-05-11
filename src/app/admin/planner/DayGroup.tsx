"use client";

import { format } from "date-fns";
import { PostSlotCard } from "./PostSlotCard";
import type { PlanSlotData } from "@/lib/planner/types";

interface DayGroupProps {
  day: Date;
  isToday: boolean;
  slots: PlanSlotData[];
  onUnschedule: (slotId: string) => void;
  onSchedule: (slotId: string) => void;
  onBodyChange: (postId: string, body: string) => void;
}

export function DayGroup({
  day,
  isToday,
  slots,
  onUnschedule,
  onSchedule,
  onBodyChange,
}: DayGroupProps) {
  if (slots.length === 0) return null;

  // Ascending by hour (nearest publish first within the day). Slots without an
  // hour land at the top so the user sees them anyway.
  const sorted = [...slots].sort((a, b) => {
    const ha = a.hour ?? -1;
    const hb = b.hour ?? -1;
    return ha - hb;
  });

  const label = isToday ? `Today, ${format(day, "MMM d")}` : format(day, "EEEE, MMM d");
  const scheduledCount = sorted.filter((s) => s.status === "SCHEDULED" && !s.published).length;
  const publishedCount = sorted.filter((s) => s.published).length;
  const proposedCount = sorted.filter(
    (s) => s.status === "PROPOSED" || s.status === "APPROVED",
  ).length;

  const parts: string[] = [];
  if (scheduledCount > 0) parts.push(`${scheduledCount} scheduled`);
  if (publishedCount > 0) parts.push(`${publishedCount} published`);
  if (proposedCount > 0) parts.push(`${proposedCount} proposed`);

  return (
    <section
      className={
        isToday
          ? "rounded-2xl border-l-[3px] border-amber-400 bg-amber-50/50 px-3 py-3"
          : ""
      }
    >
      <header className="mb-3 border-b border-[#eae7df] pb-2">
        <h3
          className={`min-w-0 truncate text-[17px] font-semibold leading-tight ${
            isToday ? "text-amber-700" : "text-[#161513]"
          }`}
        >
          {label}
        </h3>
        {parts.length > 0 && (
          <p className="mt-0.5 text-[12px] text-[#7a7870]">{parts.join(" · ")}</p>
        )}
      </header>

      <div className="space-y-3">
        {sorted.map((slot) => (
          <PostSlotCard
            key={slot.id}
            slot={slot}
            onUnschedule={onUnschedule}
            onSchedule={onSchedule}
            onBodyChange={onBodyChange}
          />
        ))}
      </div>
    </section>
  );
}
