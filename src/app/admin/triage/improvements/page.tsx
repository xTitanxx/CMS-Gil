import { ImprovementsFeed } from "./ImprovementsFeed";
import { TriageTabs } from "../TriageTabs";

export const metadata = { title: "AI suggestions" };

export default function ImprovementsPage() {
  // Auth is enforced by src/app/admin/layout.tsx — no per-page guard needed.
  return (
    <>
      <ImprovementsFeed tabs={<TriageTabs active="ai-suggestions" />} />
    </>
  );
}
