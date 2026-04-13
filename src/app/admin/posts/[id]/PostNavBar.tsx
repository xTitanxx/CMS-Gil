import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface PostNavBarProps {
  prevHref: string | null;
  nextHref: string | null;
  listHref: string;
  actions?: ReactNode;
}

// The dashboard layout's <main> has `p-8`, and `sticky top-0` on a child pins
// relative to the scroll container's PADDING edge, not its border edge — so
// a naive top-0 would leave a 32px transparent strip above the bar at all
// scroll positions. `-mt-8 -mx-8` pulls the bar up/out to cover the padding,
// and `-top-8` (negative top) shifts the sticky pin point to the border edge
// so the bar stays flush to y=0 while scrolling. `px-8` restores inner
// padding so content lines up with the rest of the page.
export function PostNavBar({
  prevHref,
  nextHref,
  listHref,
  actions,
}: PostNavBarProps) {
  return (
    <div className="sticky -top-8 z-20 -mx-8 -mt-8 mb-3 flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-8 py-2 shadow-sm">
      <Link
        href={listHref}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to list
      </Link>
      <div className="flex items-center gap-2">
        {actions}
        <div className="flex items-center gap-1">
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
