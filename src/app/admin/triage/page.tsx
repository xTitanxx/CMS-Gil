import { TriageView } from "./TriageView";
import { TriageHubTabs } from "./TriageHubTabs";

export const metadata = { title: "Triage" };

export default function TriagePage() {
  // Auth is enforced by src/app/admin/layout.tsx — no per-page guard needed.
  return (
    <div className="flex h-full flex-col">
      <TriageHubTabs />
      <div className="min-h-0 flex-1">
        <TriageView />
      </div>
    </div>
  );
}
