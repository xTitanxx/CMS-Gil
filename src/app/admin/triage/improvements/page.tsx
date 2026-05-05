import { ImprovementsFeed } from "./ImprovementsFeed";
import { TriageTabs } from "../TriageTabs";

export const metadata = { title: "AI suggestions" };

export default function ImprovementsPage() {
  // Auth is enforced by src/app/admin/layout.tsx — no per-page guard needed.
  return (
    <div className="mx-auto max-w-3xl">
      <TriageTabs active="ai-suggestions" />
      <ImprovementsFeed />
    </div>
  );
}
