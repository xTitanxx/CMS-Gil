"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

// Pages that get a centred title pill on mobile. Dashboard and individual post
// pages are intentionally absent — they show no title.
const TITLES: Record<string, string> = {
  "/admin/posts": "Posts",
  "/admin/triage": "Triage",
  "/admin/scheduled": "Posting",
  "/admin/manual-fb": "Posting",
  "/admin/published": "Posting",
  "/admin/connections": "Connections",
  "/admin/import": "Import",
  "/admin/audio": "Audio",
  "/admin/settings": "Settings",
  "/admin/trash": "Trash",
};

function titleFor(pathname: string): string {
  // Hide on individual post detail pages (/admin/posts/<id>) — keep on the list.
  if (/^\/admin\/posts\/[^/]+$/.test(pathname)) return "";
  const match = Object.keys(TITLES)
    .sort((a, b) => b.length - a.length)
    .find((p) => pathname === p || pathname.startsWith(p + "/"));
  return match ? TITLES[match] : "";
}

// Mobile chrome:
//   - Burger pill: position: fixed at top-left so the menu is always reachable.
//     Sits over content via z-30 with viewport-fit=cover + black-translucent
//     status bar, so the iOS clock/wifi/battery show through whatever's behind.
//   - Title pill: rendered INLINE (normal flow) at the top of the scroll area
//     so it scrolls away as the user reads. Padded with env(safe-area-inset-top)
//     to clear the status bar on initial load.
// Skipped entirely on /admin/assistant — that page has its own floating burger.
export function MobilePageHeader() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin/assistant")) return null;

  const title = titleFor(pathname);

  // burger = safe-area-inset-top + my-2 (8px) + h-10 (40px) + my-2 (8px) = safe-area + 3.5rem
  const burgerBlockHeight = "calc(env(safe-area-inset-top, 0px) + 3.5rem)";

  return (
    <>
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-center px-2 md:hidden"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
          className="pointer-events-auto my-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] active:bg-white/95 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>
      {title ? (
        <div
          className="flex justify-center pb-2 md:hidden"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
        >
          <div className="rounded-full bg-white/90 px-4 py-2 shadow-[0_2px_8px_rgba(0,0,0,0.08)]">
            <span className="text-sm font-semibold text-[#0d0d0d]">{title}</span>
          </div>
        </div>
      ) : (
        // No title pill — emit an invisible spacer so content clears the fixed burger.
        <div className="md:hidden" style={{ height: burgerBlockHeight }} aria-hidden />
      )}
    </>
  );
}
