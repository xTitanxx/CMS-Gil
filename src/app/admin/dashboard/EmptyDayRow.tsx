"use client";

export function EmptyDayRow({ dayKey: _dayKey }: { dayKey: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-dashed border-gray-200 px-3 py-2">
      <span className="text-xs italic text-gray-400">No posts</span>
    </div>
  );
}
