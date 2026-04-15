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

  return (
    <aside className="flex h-screen w-60 flex-col border-r border-gray-200 bg-white px-3 py-4">
      <div className="mb-6 px-3">
        <h1 className="text-lg font-bold text-gray-900">CMS Gil</h1>
        <p className="text-xs text-gray-500">Personal content hub</p>
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

        {/* Triage link with live count badge */}
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
      </nav>

      <button
        onClick={() => signOut({ callbackUrl: "/login" })}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </aside>
  );
}
