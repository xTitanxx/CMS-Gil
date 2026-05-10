"use client";
import { AlertCircle, Sparkles } from "lucide-react";
import { TabNav, type TabNavItem } from "@/app/admin/_shared/TabNav";

const TABS: TabNavItem[] = [
  { id: "needs-fixes", label: "Needs fixes", href: "/admin/triage", icon: AlertCircle },
  { id: "ai-suggestions", label: "AI suggestions", href: "/admin/triage/improvements", icon: Sparkles },
];

export function TriageTabs({ active }: { active: "needs-fixes" | "ai-suggestions" }) {
  return <TabNav tabs={TABS} activeId={active} className="mb-4" />;
}
