"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, CheckCircle2, Sparkles } from "lucide-react";

type TabId = "needs-fixes" | "ai-captions" | "approved";

const TABS: { id: TabId; label: string; href: string; icon: typeof AlertCircle }[] = [
  { id: "needs-fixes", label: "Needs fixes", href: "/admin/triage", icon: AlertCircle },
  {
    id: "ai-captions",
    label: "AI caption suggestions",
    href: "/admin/triage/improvements",
    icon: Sparkles,
  },
  { id: "approved", label: "Approved", href: "/admin/triage/approved", icon: CheckCircle2 },
];

function activeIdFor(pathname: string): TabId {
  if (pathname.startsWith("/admin/triage/improvements")) return "ai-captions";
  if (pathname.startsWith("/admin/triage/approved")) return "approved";
  return "needs-fixes";
}

export function TriageHubTabs() {
  const pathname = usePathname();
  const activeId = activeIdFor(pathname);
  const [needsFixesCount, setNeedsFixesCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/triage/count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data?.total === "number") {
          setNeedsFixesCount(data.total);
        }
      } catch {
        // silent
      }
    }
    void load();
  }, []);

  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4 md:mx-0 md:px-0">
      {TABS.map((t) => {
        const isActive = t.id === activeId;
        const Icon = t.icon;
        return (
          <a
            key={t.id}
            href={t.href}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-800"
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{t.label}</span>
            {t.id === "needs-fixes" && needsFixesCount != null && needsFixesCount > 0 && (
              <span className="ml-0.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-gray-600">
                {needsFixesCount > 999 ? "999+" : needsFixesCount}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
