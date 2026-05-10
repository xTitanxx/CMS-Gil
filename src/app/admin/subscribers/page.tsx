import { PageHeader } from "@/app/admin/_shared/PageHeader";
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
      <PageHeader
        title="Subscribers"
        subtitle="Per-person paid access to the Archivist. Click a subscriber to see their bookmarks, comments, and usage."
      />
      <SubscribersListClient />
    </div>
  );
}
