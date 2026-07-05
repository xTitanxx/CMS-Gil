"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Sparkles, Bookmark, Search } from "lucide-react";

// Path-aware nav for the public header. Highlights the current page and
// drops links that would just navigate to where the user already is — so the
// bookmarks page doesn't show another "Bookmarks" pill, and /chat doesn't
// show "Talk to the Archivist". Always includes a Feed/Home link when off
// the feed, so there's a clear way back.

function isActive(pathname: string, target: string): boolean {
  if (target === "/") return pathname === "/";
  return pathname === target || pathname.startsWith(`${target}/`);
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, the chip uses the accent (blue) styling instead of neutral. */
  accent?: boolean;
}

const ITEMS: NavItem[] = [
  { href: "/", label: "Feed", icon: Home },
  { href: "/chat", label: "Talk to the Archivist", icon: Sparkles, accent: true },
  { href: "/bookmarks", label: "Bookmarks", icon: Bookmark },
  { href: "/search", label: "Search", icon: Search },
];

export function HeaderNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {ITEMS.map(({ href, label, icon: Icon, accent }) => {
        const active = isActive(pathname, href);
        // Active link: stays as a Link (so users can re-click for a refresh)
        // but is styled distinctly. Inactive: same chip layout, lighter ink.
        const accentClasses = accent
          ? active
            ? "bg-blue-600 text-white"
            : "bg-blue-50 text-blue-700 hover:bg-blue-100"
          : active
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:bg-gray-100";
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${accentClasses}`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
