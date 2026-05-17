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
  // Compact ("Jan 10, 14:10") — same shape as the old meta bar so muscle memory carries.
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// On desktop, the dashboard layout's <main> has `p-8`, and `sticky top-0` on a
// child pins relative to the scroll container's PADDING edge, not its border
// edge — so a naive top-0 would leave a 32px transparent strip above the bar
// at all scroll positions. `md:-mt-8 md:-mx-8` pulls the bar up/out to cover
// the padding, and `md:-top-8` shifts the sticky pin point to the border edge
// so the bar stays flush to y=0 while scrolling. `md:px-8` restores inner
// padding so content lines up with the rest of the page.
//
// On mobile, <main> has no padding and the page wrapper has only `px-4`, so
// applying those negative offsets would (a) overflow horizontally and (b)
// drag the opaque white bar up under the iOS status bar. Instead, mobile
// uses a frosted translucent bar with `top-0` and no negative margins.
//
// `pl-14` on mobile reserves the top-left for the floating MobilePageHeader
// burger (h-10 w-10 at left=8px). Without it, the back arrow ends up under
// the burger.
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
    <div
      className="sticky top-0 z-20 mb-3 flex items-center gap-1.5 border-b border-gray-200 bg-white/85 pl-14 pr-2 py-2 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/65 sm:gap-2 sm:pr-3 md:-top-8 md:-mx-8 md:-mt-8 md:bg-white md:px-8 md:supports-[backdrop-filter]:bg-white"
      style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
    >
      <Link
        href={listHref}
        scroll={false}
        aria-label={backLabel}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-sm text-gray-600 hover:bg-gray-100 sm:px-2"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{backLabel}</span>
      </Link>

      {/* Inline meta — date + original link. min-w-0 + truncate so the row
          stays one line at 375px instead of pushing the trailing controls
          off-screen. */}
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

      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
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
