"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileText,
  Upload,
  Link2,
  CalendarClock,
  LogOut,
  CheckSquare,
  Music,
  Sparkles,
  AlertCircle,
  Star,
  X,
  Settings,
  MessageSquare,
} from "lucide-react";
import { signOut } from "next-auth/react";

type NavItem =
  | { type: "link"; href: string; label: string; icon: typeof FileText; badge?: "triage" }
  | { type: "separator" };

const nav: NavItem[] = [
  { type: "link", href: "/admin/assistant", label: "Assistant", icon: Sparkles },
  { type: "link", href: "/admin/scheduled", label: "Scheduled", icon: CalendarClock },
  { type: "separator" },
  { type: "link", href: "/admin/posts", label: "All Posts", icon: FileText },
  { type: "link", href: "/admin/triage", label: "Triage", icon: AlertCircle, badge: "triage" },
  { type: "link", href: "/admin/comments", label: "Comments", icon: MessageSquare },
  { type: "link", href: "/admin/audio", label: "Audio Library", icon: Music },
  { type: "link", href: "/admin/rate", label: "Review Posts", icon: Star },
  { type: "separator" },
  { type: "link", href: "/admin/import", label: "Import", icon: Upload },
  { type: "link", href: "/admin/connections", label: "Connections", icon: Link2 },
  { type: "separator" },
  { type: "link", href: "/admin/todo", label: "To-Do", icon: CheckSquare },
  { type: "link", href: "/admin/settings", label: "Settings", icon: Settings },
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

  // Allow the MobilePageHeader (or anything else) to open the drawer
  // by dispatching a window event. Single source of truth for "open menu".
  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("open-sidebar", open);
    return () => window.removeEventListener("open-sidebar", open);
  }, []);

  // Lock body scroll while drawer is open — without this, swipes on the
  // overlay can bleed through and the drawer can wedge into an unresponsive state.
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  const navContent = (
    <>
      <div className="mb-6 flex items-center justify-between px-3">
        <h1 className="text-lg font-bold text-gray-900">Content Hub</h1>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden touch-manipulation"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {nav.map((item, i) => {
          if (item.type === "separator") {
            return <hr key={i} className="my-2 border-gray-200" />;
          }
          const { href, label, icon: Icon, badge } = item;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors touch-manipulation",
                pathname.startsWith(href)
                  ? "bg-blue-50 text-blue-700"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
              {badge === "triage" && <TriageBadge />}
            </Link>
          );
        })}
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
      {/* Desktop sidebar */}
      <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-gray-200 bg-white px-3 py-4 md:flex">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden touch-manipulation"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            className="fixed left-0 top-0 z-50 flex h-dvh w-[85%] max-w-xs flex-col border-r border-gray-200 bg-white px-3 py-4 md:hidden"
            style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 1rem)" }}
          >
            {navContent}
          </aside>
        </>
      )}
    </>
  );
}
