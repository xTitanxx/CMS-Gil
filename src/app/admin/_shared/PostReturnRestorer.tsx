"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { consumePendingScroll } from "./post-return";

// When the back button on a post detail page navigates to a list page, it
// stores the target URL + scroll position in sessionStorage. This component
// runs on every admin route change and, if the current URL matches a
// pending scroll target, restores the scroll on both the <main> scroll
// container (desktop) and window (mobile).
//
// Mounted once at the admin layout level.
export function PostReturnRestorer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const search = searchParams?.toString() ?? "";
    const currentUrl = search ? `${pathname}?${search}` : pathname;
    const pending = consumePendingScroll(currentUrl);
    if (!pending) return;

    // Wait for the destination page to render before scrolling. Two RAFs
    // give the new route a chance to mount its content; otherwise we'd
    // scroll before the page is tall enough to land at the target Y.
    let cancelled = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        const main = document.getElementById("main-content");
        if (main && pending.mainScroll > 0) {
          main.scrollTo({ top: pending.mainScroll, behavior: "auto" });
        }
        if (pending.windowScroll > 0) {
          window.scrollTo({ top: pending.windowScroll, behavior: "auto" });
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [pathname, searchParams]);

  return null;
}
