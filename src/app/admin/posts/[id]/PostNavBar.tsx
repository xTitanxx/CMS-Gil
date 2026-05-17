import Link from "next/link";
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

interface PostNavBarProps {
  prevHref: string | null;
  nextHref: string | null;
  listHref: string;
  backLabel?: string;
  /** Original date of the post — surfaced inline so we don't need a separate meta bar. */
  originalDate?: Date | null;
  /** External link to the source post on the originating platform, if any. */
  platformUrl?: string | null;
  actions?: ReactNode;
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Desktop-only sticky bar. On mobile, MobilePostActions renders frosted-glass
// pills in the fixed top row alongside MobilePageHeader's burger, and the
// date moves into PostEditor's article meta chip.
//
// `md:-mt-8 md:-mx-8 md:-top-8` pulls the bar up/out to cover <main>'s p-8
// padding, then `md:px-8` restores inner padding so content lines up.
export function PostNavBar({
  prevHref,
  nextHref,
  listHref,
  backLabel = "Back",
  originalDate,
  platformUrl,
  actions,
}: PostNavBarProps) {
  return (
    <div className="sticky top-0 z-20 mb-3 hidden items-center gap-2 border-b border-gray-200 bg-white px-8 py-2 shadow-sm md:-mx-8 md:-mt-8 md:-top-8 md:flex">
      <Link
        href={listHref}
        scroll={false}
        aria-label={backLabel}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>{backLabel}</span>
      </Link>

      {(originalDate || platformUrl) && (
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-gray-500">
          {originalDate && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <Calendar className="h-3 w-3 shrink-0 text-gray-400" />
              <span className="truncate tabular-nums">{formatDateShort(originalDate)}</span>
            </span>
          )}
          {platformUrl && (
            <a
              href={platformUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Open original"
              title="Open original"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
      {!(originalDate || platformUrl) && <div className="flex-1" />}

      <div className="flex shrink-0 items-center gap-2">
        {actions}
        <div className="flex items-center">
          <NavButton href={prevHref} direction="prev" label="Previous post" />
          <NavButton href={nextHref} direction="next" label="Next post" />
        </div>
      </div>
    </div>
  );
}

function NavButton({
  href,
  direction,
  label,
}: {
  href: string | null;
  direction: "prev" | "next";
  label: string;
}) {
  const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
  const base =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-600 transition-colors";
  if (!href) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={`${base} cursor-not-allowed opacity-40`}
      >
        <Icon className="h-4 w-4" />
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={`${base} hover:bg-gray-100 hover:text-gray-900`}
      prefetch
    >
      <Icon className="h-4 w-4" />
    </Link>
  );
}
