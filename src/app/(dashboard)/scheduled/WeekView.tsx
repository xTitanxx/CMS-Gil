"use client";

interface CalendarEntry {
  id: string;
  postId: string;
  platform: string;
  status: string;
  scheduledAt: string;
  body: string;
}

interface WeekViewProps {
  entries: CalendarEntry[];
  cursor: Date;
}

export function WeekView({ entries, cursor }: WeekViewProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <p className="text-gray-500">Week view for {cursor.toDateString()}</p>
      <p className="text-sm text-gray-400 mt-2">{entries.length} entries</p>
    </div>
  );
}
