"use client";
import { AlertCircle, Sparkles } from "lucide-react";
import { SegmentedControl } from "@/app/admin/_shared/SegmentedControl";

const OPTIONS = [
  { id: "needs-fixes" as const, label: "Needs fixes", href: "/admin/triage", icon: AlertCircle },
  {
    id: "ai-suggestions" as const,
    label: "AI suggestions",
    href: "/admin/triage/improvements",
    icon: Sparkles,
  },
];

export function TriageTabs({ active }: { active: "needs-fixes" | "ai-suggestions" }) {
  return <SegmentedControl options={OPTIONS} value={active} ariaLabel="Triage view" mode="link" />;
}
