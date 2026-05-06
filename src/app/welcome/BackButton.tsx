"use client";

import { ArrowLeft } from "lucide-react";

/**
 * "Back" button for the welcome page. Prefers history.back() so the user
 * lands at the same scroll position they came from. Falls back to `next`
 * (or `/`) when there is no same-origin referrer — e.g. the user opened
 * /welcome directly or via a link from outside the site.
 */
export function BackButton({ next }: { next: string }) {
  function handleClick() {
    const sameOriginReferrer =
      typeof document !== "undefined" &&
      document.referrer &&
      (() => {
        try {
          return new URL(document.referrer).origin === window.location.origin;
        } catch {
          return false;
        }
      })();

    if (sameOriginReferrer && window.history.length > 1) {
      window.history.back();
      return;
    }
    const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    window.location.assign(safeNext);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </button>
  );
}
