import { ContentCalendar } from "../scheduled/ContentCalendar";

export const metadata = { title: "Published" };

export default function PublishedPage() {
  return (
    <div className="flex flex-col h-full space-y-4">
      <div>
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Published</h1>
        <p className="text-sm text-gray-500">Posts published through the hub</p>
      </div>
      <div className="flex-1 min-h-0">
        <ContentCalendar statusFilter="published" />
      </div>
    </div>
  );
}
