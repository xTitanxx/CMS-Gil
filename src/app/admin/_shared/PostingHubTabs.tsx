"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { TabNav } from "./TabNav";

type TabId = "scheduled" | "manual-fb" | "published";

const TABS: { id: TabId; label: string; href: string }[] = [
  { id: "scheduled", label: "Scheduled", href: "/admin/scheduled" },
  { id: "manual-fb", label: "Manual FB", href: "/admin/manual-fb" },
  { id: "published", label: "Published", href: "/admin/published" },
];

function activeIdFor(pathname: string): TabId {
  if (pathname.startsWith("/admin/manual-fb")) return "manual-fb";
  if (pathname.startsWith("/admin/published")) return "published";
  return "scheduled";
}

export function PostingHubTabs() {
  const pathname = usePathname();
  const activeId = activeIdFor(pathname);
  const [manualFbOverdue, setManualFbOverdue] = useState<number>(0);

  // Mirror Sidebar's ManualFbBadge — surface the overdue count next to the
  // Manual FB tab too, so it's visible without leaving the page.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/admin/manual-fb-queue/count");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setManualFbOverdue(typeof data?.overdue === "number" ? data.overdue : 0);
        }
      } catch {
        // silent
      }
    }
    void load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <nav className="-mx-4 mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 px-4 md:mx-0 md:px-0">
      {TABS.map((t) => {
        const isActive = t.id === activeId;
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
            {t.id === "scheduled" && <CalendarClock className="h-4 w-4" />}
            {t.id === "manual-fb" && (
              <SiFacebook className={isActive ? "h-4 w-4 text-[#1877F2]" : "h-4 w-4"} />
            )}
            {t.id === "published" && <CheckCircle2 className="h-4 w-4" />}
            <span>{t.label}</span>
            {t.id === "manual-fb" && manualFbOverdue > 0 && (
              <span className="ml-0.5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {manualFbOverdue > 99 ? "99+" : manualFbOverdue}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}

// Keep TabNav available for other callers that need the simpler primitive.
export { TabNav };
