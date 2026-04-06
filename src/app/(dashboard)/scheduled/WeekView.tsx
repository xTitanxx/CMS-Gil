"use client";

import { format, isToday, isSameDay } from "date-fns";
import Link from "next/link";
import { ImageIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getGridDays, groupEntriesByDate } from "./calendar-utils";
import type { CalendarEntry } from "./types";

const STATUS_CARD: Record<string, string> = {
  PENDING: "bg-blue-50 border-blue-200",
  PUBLISHED: "bg-green-50 border-green-200",
  IMPORTED: "bg-gray-50 border-gray-200",
};

const BADGE_VARIANT: Record<string, "secondary" | "success" | "outline"> = {
  PENDING: "secondary",
  PUBLISHED: "success",
  IMPORTED: "outline",
};

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

export function WeekView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = getGridDays("week", cursor);
  const grouped = groupEntriesByDate(entries);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-7 divide-x divide-gray-100">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = grouped[key] ?? [];
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;

          return (
            <div
              key={key}
              className={`flex flex-col min-h-[400px] ${isSelected ? "bg-blue-50" : "bg-white"}`}
            >
              {/* Column header — clicking it opens the DayPanel */}
              <button
                onClick={() => onDayClick(day)}
                className="py-2 text-center border-b border-gray-100 hover:bg-gray-50 transition-colors w-full"
              >
                <div className="text-xs text-gray-500">{format(day, "EEE")}</div>
                <div
                  className={[
                    "text-sm font-medium mx-auto w-7 h-7 flex items-center justify-center rounded-full",
                    isToday(day) ? "bg-blue-600 text-white" : "text-gray-800",
                  ].join(" ")}
                >
                  {format(day, "d")}
                </div>
              </button>

              {/* Post cards */}
              <div className="flex-1 p-1 space-y-1 overflow-y-auto">
                {dayEntries.map((entry) => (
                  <Link
                    key={entry.postId}
                    href={`/posts/${entry.postId}`}
                    className={`flex items-start gap-1.5 p-1.5 rounded border text-left ${STATUS_CARD[entry.status] ?? ""} hover:opacity-80 transition-opacity`}
                  >
                    <div className="w-8 h-8 flex-shrink-0 rounded overflow-hidden">
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
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700 line-clamp-2 leading-tight">
                        {entry.body}
                      </p>
                      {entry.platform && (
                        <Badge
                          variant={BADGE_VARIANT[entry.status] ?? "outline"}
                          className="text-xs mt-0.5 py-0 h-4"
                        >
                          {entry.platform}
                        </Badge>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
