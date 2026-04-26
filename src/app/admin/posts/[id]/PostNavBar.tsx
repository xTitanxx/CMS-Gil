import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface PostNavBarProps {
  prevHref: string | null;
  nextHref: string | null;
  listHref: string;
  backLabel?: string;
  actions?: ReactNode;
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
export function PostNavBar({
  prevHref,
  nextHref,
  listHref,
  backLabel = "Back to list",
  actions,
}: PostNavBarProps) {
  return (
    <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-2 border-b border-gray-200 bg-white/85 px-3 py-2 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/65 md:-top-8 md:-mx-8 md:-mt-8 md:gap-3 md:bg-white md:px-8 md:supports-[backdrop-filter]:bg-white">
      <Link
        href={listHref}
        scroll={false}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
      >
        <ArrowLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{backLabel}</span>
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
