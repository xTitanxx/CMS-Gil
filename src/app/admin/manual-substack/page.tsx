import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ManualSubstackQueueClient } from "./ManualSubstackQueueClient";

export const metadata = { title: "Manual Substack queue" };
export const dynamic = "force-dynamic";

export default async function ManualSubstackQueuePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/api/auth/signin?callbackUrl=/admin/manual-substack");
  }

  return <ManualSubstackQueueClient />;
}
