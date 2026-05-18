"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent, ReactNode } from "react";
import {
  readReturn,
  setPendingScroll,
} from "@/app/admin/_shared/post-return";

// Headless "← back to list" link for the post detail page. Reads the URL
// and scroll position captured by PostReturnTracker when the user clicked
// into this post, and navigates back to that exact spot. Falls back to
// the server-computed listHref (from=planner / from=assistant / current
// filter query) when no sessionStorage entry exists — e.g. a fresh page
// load or after sessionStorage was cleared.
//
// Headless because the desktop bar and the mobile pill have very
// different visuals; callers supply their own className + children.
export function BackToListLink({
  fallbackHref,
  className,
  ariaLabel,
  children,
}: {
  fallbackHref: string;
  className?: string;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const router = useRouter();

  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    e.preventDefault();

    const stored = readReturn();
    const target = stored?.url ?? fallbackHref;
    if (stored) {
      setPendingScroll({
        url: stored.url,
        mainScroll: stored.mainScroll,
        windowScroll: stored.windowScroll,
      });
    }
    router.push(target, { scroll: false });
  }

  return (
    <a
      href={fallbackHref}
      onClick={onClick}
      aria-label={ariaLabel}
      className={className}
    >
      {children}
    </a>
  );
}
