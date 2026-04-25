"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

const TITLES: Record<string, string> = {
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

// Two floating frosted pills (burger left, title centred) that sit OVER scrolling page
// content — no opaque bar, no border. position: fixed so content fills the whole
// viewport including the area under the iOS status bar (with viewport-fit=cover +
// black-translucent status bar style, content shows through behind clock/wifi/battery).
// The container is pointer-events-none so taps fall through to content; only the
// pills themselves are interactive.
// Skipped on /admin/assistant — that page provides its own floating burger.
export function MobilePageHeader() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin/assistant")) return null;

  const title = titleFor(pathname);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center justify-between px-2 md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
        className="pointer-events-auto my-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/40 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 active:bg-white/70 touch-manipulation"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>
      {title && (
        <div className="my-2 rounded-full bg-white/40 px-4 py-2 backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
          <span className="text-sm font-semibold text-[#0d0d0d]">{title}</span>
        </div>
      )}
      <div className="h-10 w-10" aria-hidden />
    </div>
  );
}
