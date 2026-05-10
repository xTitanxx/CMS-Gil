import Link from "next/link";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface TabNavItem {
  id: string;
  label: string;
  href: string;
  icon?: LucideIcon;
}

interface TabNavProps {
  tabs: TabNavItem[];
  activeId: string;
  className?: string;
}

export function TabNav({ tabs, activeId, className }: TabNavProps) {
  return (
    <nav className={cn("flex gap-1 border-b border-gray-200", className)}>
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              t.id === activeId
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:border-gray-200 hover:text-gray-800"
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
