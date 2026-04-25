"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
  "/admin/assistant": "Assistant",
  "/admin/dashboard": "Dashboard",
  "/admin/posts": "Posts",
  "/admin/triage": "Triage",
  "/admin/scheduled": "Scheduled",
  "/admin/connections": "Connections",
  "/admin/import": "Import",
  "/admin/audio": "Audio",
  "/admin/rate": "Review",
  "/admin/settings": "Settings",
  "/admin/todo": "To-Do",
  "/admin/trash": "Trash",
};

function titleFor(pathname: string): string {
  const match = Object.keys(TITLES)
    .sort((a, b) => b.length - a.length)
    .find((p) => pathname === p || pathname.startsWith(p + "/"));
  return match ? TITLES[match] : "";
}

export function MobilePageHeader() {
  const pathname = usePathname();
  const title = titleFor(pathname);

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-center bg-white/70 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 ring-1 ring-black/5 md:hidden"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 0px)",
      }}
    >
      <div className="relative flex h-12 w-full items-center justify-center px-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
          className="absolute left-2 flex h-9 w-9 items-center justify-center rounded-full bg-white/70 text-[#0d0d0d] shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-md ring-1 ring-black/5 active:bg-gray-100 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="truncate text-base font-semibold text-[#0d0d0d]">{title}</h1>
      </div>
    </header>
  );
}
