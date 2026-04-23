import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TriageView } from "./TriageView";
import { TriageTabs } from "./TriageTabs";

export const metadata = { title: "Triage" };

export default async function TriagePage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <TriageTabs active="needs-fixes" />
      <TriageView />
    </div>
  );
}
