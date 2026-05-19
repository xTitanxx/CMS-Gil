import { ApprovedFeed } from "./ApprovedFeed";
import { TriageHubTabs } from "../TriageHubTabs";

export const metadata = { title: "Approved" };

export default function ApprovedPage() {
  // Auth is enforced by src/app/admin/layout.tsx — no per-page guard needed.
  return (
    <div className="flex h-full flex-col">
      <TriageHubTabs />
      <div className="min-h-0 flex-1">
        <ApprovedFeed />
      </div>
    </div>
  );
}
