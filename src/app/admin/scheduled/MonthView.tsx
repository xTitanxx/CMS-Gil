import {
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  isToday,
  startOfMonth,
} from "date-fns";
import type { CalendarEntry } from "./types";
import { groupEntriesByDate } from "./calendar-utils";
import { PlatformIcons } from "./PlatformIcons";

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = eachDayOfInterval({
    start: startOfMonth(cursor),
    end: endOfMonth(cursor),
  });
  const firstDayOffset = days[0].getDay();
  const byDate = groupEntriesByDate(entries);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="px-2 py-2 text-center text-xs font-medium text-gray-500"
          >
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, idx) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = byDate[key] ?? [];
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          const today = isToday(day);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDayClick(day)}
              style={idx === 0 ? { gridColumnStart: firstDayOffset + 1 } : undefined}
              className={`min-h-[100px] border-b border-r border-gray-200 bg-white p-1.5 text-left transition-colors ${
                isSelected
                  ? "ring-2 ring-inset ring-blue-600"
                  : "hover:bg-gray-50"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    today ? "bg-blue-600 text-white" : "text-gray-900"
                  }`}
                >
                  {format(day, "d")}
                </span>
                {dayEntries.length > 0 && (
                  <span className="text-[10px] font-medium text-gray-500">
                    {dayEntries.length}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEntries.slice(0, 3).map((e, i) => (
                  <div
                    key={`${e.postId}-${e.status}-${i}`}
                    className={`flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium ${statusClass(e.status)}`}
                    title={e.body}
                  >
                    {e.time && (
                      <span className="font-semibold tabular-nums">{e.time}</span>
                    )}
                    {e.platforms.length > 0 ? (
                      <PlatformIcons platforms={e.platforms} size={11} />
                    ) : (
                      <span className="truncate">
                        {e.status === "PROPOSED"
                          ? "Proposed"
                          : e.status === "PLAN_APPROVED"
                            ? "Approved"
                            : "Imported"}
                      </span>
                    )}
                  </div>
                ))}
                {dayEntries.length > 3 && (
                  <div className="text-[10px] text-gray-500">
                    +{dayEntries.length - 3} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function statusClass(status: CalendarEntry["status"]): string {
  switch (status) {
    case "PUBLISHED":
      return "bg-green-100 text-green-800";
    case "PENDING":
      return "bg-yellow-100 text-yellow-800";
    case "IMPORTED":
      return "bg-gray-100 text-gray-700";
    case "PROPOSED":
      return "border border-dashed border-gray-400 bg-white text-gray-500 opacity-70";
    case "PLAN_APPROVED":
      return "border border-blue-400 bg-blue-50 text-blue-800";
  }
}
