import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ImprovementsFeed } from "./ImprovementsFeed";
import { TriageTabs } from "../TriageTabs";

export const metadata = { title: "AI suggestions" };

export default async function ImprovementsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <TriageTabs active="ai-suggestions" />
      <ImprovementsFeed />
    </div>
  );
}
