// src/app/(dashboard)/scheduled/MonthView.tsx

"use client";

import { format, isSameMonth, isToday, isSameDay } from "date-fns";
import { ImageIcon } from "lucide-react";
import { getGridDays, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_RING: Record<string, string> = {
  PENDING: "ring-2 ring-blue-400",
  PUBLISHED: "ring-2 ring-green-400",
  IMPORTED: "ring-2 ring-gray-300",
};

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

export function MonthView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = getGridDays("month", cursor);
  const grouped = groupEntriesByDate(entries);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {DAY_LABELS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-xs font-medium text-gray-500"
          >
            {d}
          </div>
        ))}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {days.map((day, i) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = grouped[key] ?? [];
          const isCurrentMonth = isSameMonth(day, cursor);
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;

          return (
            <button
              key={key}
              onClick={() => onDayClick(day)}
              className={[
                "min-h-[80px] p-1.5 border-b border-r border-gray-100 text-left",
                "hover:bg-blue-50 transition-colors",
                isSelected
                  ? "bg-blue-50"
                  : !isCurrentMonth
                  ? "bg-gray-50"
                  : "bg-white",
              ].join(" ")}
            >
              {/* Date number */}
              <span
                className={[
                  "text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full mb-1",
                  isToday(day)
                    ? "bg-blue-600 text-white"
                    : isCurrentMonth
                    ? "text-gray-800"
                    : "text-gray-400",
                ].join(" ")}
              >
                {format(day, "d")}
              </span>

              {/* Thumbnails */}
              <div className="flex flex-wrap gap-0.5">
                {dayEntries.slice(0, 3).map((entry) => (
                  <div
                    key={entry.postId}
                    className={`w-7 h-7 rounded overflow-hidden flex-shrink-0 ${STATUS_RING[entry.status] ?? ""}`}
                  >
                    {entry.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={entry.thumbUrl}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                        <ImageIcon className="w-3 h-3 text-gray-300" />
                      </div>
                    )}
                  </div>
                ))}
                {dayEntries.length > 3 && (
                  <span className="text-xs text-gray-400 self-end ml-0.5">
                    +{dayEntries.length - 3}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
