import { TriageView } from "./TriageView";
import { TriageTabs } from "./TriageTabs";

export const metadata = { title: "Triage" };

export default function TriagePage() {
  // Auth is enforced by src/app/admin/layout.tsx — no per-page guard needed.
  return <TriageView tabs={<TriageTabs active="needs-fixes" />} />;
}
