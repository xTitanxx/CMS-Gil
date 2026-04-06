"use client";

interface CalendarEntry {
  id: string;
  postId: string;
  platform: string;
  status: string;
  scheduledAt: string;
  body: string;
}

interface DayPanelProps {
  entries: CalendarEntry[];
  cursor: Date;
}

export function DayPanel({ entries, cursor }: DayPanelProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <p className="text-gray-500">Day panel for {cursor.toDateString()}</p>
      <p className="text-sm text-gray-400 mt-2">{entries.length} entries</p>
    </div>
  );
}
