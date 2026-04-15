"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Upload,
  Link2,
  CalendarClock,
  LogOut,
  CheckSquare,
  Music,
  AlertCircle,
  Star,
  Menu,
  X,
} from "lucide-react";
import { signOut } from "next-auth/react";

const nav = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/posts", label: "All Posts", icon: FileText },
  { href: "/admin/import", label: "Import", icon: Upload },
  { href: "/admin/audio", label: "Audio Library", icon: Music },
  { href: "/admin/connections", label: "Connections", icon: Link2 },
  { href: "/admin/scheduled", label: "Scheduled", icon: CalendarClock },
  { href: "/admin/todo", label: "To-Do", icon: CheckSquare },
];

function TriageBadge() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    async function fetch_() {
      try {
        const res = await fetch("/api/triage/count");
        if (res.ok) {
          const data = await res.json();
          setCount(data.total ?? 0);
        }
      } catch {
        // silent
      }
    }
    void fetch_();
    const interval = setInterval(fetch_, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!count) return null;
  return (
    <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const navContent = (
    <>
      <div className="mb-6 flex items-center justify-between px-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">CMS Gil</h1>
          <p className="text-xs text-gray-500">Personal content hub</p>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith(href)
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}

        <Link
          href="/admin/triage"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/admin/triage")
              ? "bg-blue-50 text-blue-700"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          )}
        >
          <AlertCircle className="h-4 w-4" />
          Triage
          <TriageBadge />
        </Link>

        <Link
          href="/admin/rate"
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            pathname.startsWith("/admin/rate")
              ? "bg-blue-50 text-blue-700"
              : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
          )}
        >
          <Star className="h-4 w-4" />
          Rate Posts
        </Link>
      </nav>

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-gray-200 bg-white px-3 py-2 md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-gray-700 hover:bg-gray-100"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold text-gray-900">CMS Gil</h1>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-4 md:flex">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed left-0 top-0 z-50 flex h-dvh w-[85%] max-w-xs flex-col border-r border-gray-200 bg-white px-3 py-4 md:hidden">
            {navContent}
          </aside>
        </>
      )}
    </>
  );
}
