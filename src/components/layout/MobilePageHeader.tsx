"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

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
          className="pointer-events-auto my-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/40 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 active:bg-white/70 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>
      {/* Invisible spacer so content clears the fixed burger button. */}
      <div className="md:hidden" style={{ height: burgerBlockHeight }} aria-hidden />
    </>
  );
}
