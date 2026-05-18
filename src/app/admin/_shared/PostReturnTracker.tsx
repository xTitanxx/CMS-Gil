"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { captureCurrentReturn } from "./post-return";

const POST_DETAIL_RE = /^\/admin\/posts\/[^/]+$/;

function isPostDetailHref(href: string): boolean {
  if (!href) return false;
  const path = href.split("?")[0]?.split("#")[0] ?? "";
  if (!POST_DETAIL_RE.test(path)) return false;
  const id = path.slice("/admin/posts/".length);
  return id !== "new";
}

// Captures the current page URL + scroll position whenever the user clicks
// a link into a post detail page, so the back button on that detail page
// can return them here. Mounted once at the admin layout level.
//
// Skips capture when already on a post detail page so that prev/next
// post navigation doesn't overwrite the original entry point.
export function PostReturnTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (POST_DETAIL_RE.test(pathname)) return;

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;

      const href = anchor.getAttribute("href") || "";
      if (!isPostDetailHref(href)) return;

      captureCurrentReturn();
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  return null;
}
