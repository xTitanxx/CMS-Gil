import { ContentCalendar } from "./ContentCalendar";

export const metadata = { title: "Scheduled" };

export default function ScheduledPage() {
  return (
    <div className="flex flex-col h-full space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Content Calendar</h1>
        <p className="text-sm text-gray-500">Scheduled and published posts</p>
      </div>
      <div className="flex-1 min-h-0">
        <ContentCalendar />
      </div>
    </div>
  );
}
