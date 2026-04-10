import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface PostNavBarProps {
  prevHref: string | null;
  nextHref: string | null;
  listHref: string;
  source: string;
}

export function PostNavBar({
  prevHref,
  nextHref,
  listHref,
  source,
}: PostNavBarProps) {
  return (
    <div className="sticky top-0 z-20 -mx-6 flex items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-6 py-2 backdrop-blur">
      <div className="flex items-center gap-3">
        <Link
          href={listHref}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to list
        </Link>
        <Badge variant="outline">{source}</Badge>
      </div>
      <div className="flex items-center gap-1">
        <NavButton href={prevHref} direction="prev" label="Previous post" />
        <NavButton href={nextHref} direction="next" label="Next post" />
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
