import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SubscribersListClient } from "./SubscribersListClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscribers" };

export default async function AdminSubscribersPage() {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/login");

  return (
    <div className="px-6 py-8">
      <div className="mb-4">
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Subscribers</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Per-person paid access to the Archivist. Click a subscriber to see
          their bookmarks, comments, and usage.
        </p>
      </div>
      <SubscribersListClient />
    </div>
  );
}
