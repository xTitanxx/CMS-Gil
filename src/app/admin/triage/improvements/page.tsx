import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ImprovementsFeed } from "./ImprovementsFeed";
import { TriageTabs } from "../TriageTabs";

export const metadata = { title: "Post Improvements — CMS Gil" };

export default async function ImprovementsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Triage</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-suggested caption rewrites for low-quality or non-evergreen posts.
        </p>
      </div>
      <TriageTabs active="improvements" />
      <ImprovementsFeed />
    </div>
  );
}
