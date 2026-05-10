"use client";
import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";

const TABS = [
  { slug: "needs-fixes", label: "Needs fixes", href: "/admin/triage", icon: AlertCircle },
  { slug: "ai-suggestions", label: "AI suggestions", href: "/admin/triage/improvements", icon: Sparkles },
] as const;

export function TriageTabs({ active }: { active: "needs-fixes" | "ai-suggestions" }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-gray-200">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.slug === active;
        return (
          <Link
            key={t.slug}
            href={t.href}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-800"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
