import { format, isSameDay, isToday } from "date-fns";
import type { CalendarEntry } from "./types";
import { getGridDays, groupEntriesByDate } from "./calendar-utils";
import { PlatformIcons } from "./PlatformIcons";

interface Props {
  cursor: Date;
  entries: CalendarEntry[];
  onDayClick: (day: Date) => void;
  selectedDay: Date | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeekView({ cursor, entries, onDayClick, selectedDay }: Props) {
  const days = getGridDays("week", cursor);
  const byDate = groupEntriesByDate(entries);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="overflow-x-auto md:overflow-x-visible snap-x snap-mandatory">
        <div className="min-w-[980px] md:min-w-0">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {days.map((day) => (
          <div key={format(day, "yyyy-MM-dd")} className="snap-start px-2 py-2 text-center">
            <div className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              {WEEKDAYS[day.getDay()]}
            </div>
            <div
              className={`mx-auto mt-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                isToday(day)
                  ? "bg-blue-600 font-semibold text-white"
                  : "text-gray-900"
              }`}
            >
              {format(day, "d")}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const dayEntries = byDate[key] ?? [];
          const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
          return (
            <div
              key={key}
              onClick={() => onDayClick(day)}
              className={`flex h-[calc(100vh-16rem)] min-h-[420px] cursor-pointer flex-col snap-start border-r border-gray-200 transition-colors ${
                isSelected ? "bg-blue-50" : "bg-white hover:bg-gray-50"
              }`}
            >
              <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
                {dayEntries.length === 0 ? (
                  <div className="pt-2 text-center text-[11px] text-gray-400">
                    No posts
                  </div>
                ) : (
                  dayEntries.map((e, i) => (
                    <div
                      key={`${e.postId}-${e.status}-${i}`}
                      className={`overflow-hidden rounded ${statusClass(e.status)}`}
                      title={e.body}
                    >
                      {e.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={e.thumbUrl}
                          alt=""
                          className="h-20 w-full object-cover"
                        />
                      ) : null}
                      <div className="px-1.5 py-1">
                        <div className="flex items-center gap-1">
                          {e.platforms.length > 0 ? (
                            <PlatformIcons platforms={e.platforms} size={12} />
                          ) : (
                            <span className="text-[10px] font-semibold uppercase tracking-wide">
                              {e.status === "PROPOSED"
                                ? "Proposed"
                                : e.status === "PLAN_APPROVED"
                                  ? "Approved"
                                  : "Imported"}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug opacity-90">
                          {e.body || "(no caption)"}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
        </div>
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
