"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WeeklyPlanView } from "./WeeklyPlanView";
import type { WeeklyPlanData } from "@/lib/planner/types";

interface Stats {
  totalPosts: number;
  published: number;
  scheduled: number;
}

interface PlannerDashboardProps {
  initialPlan: WeeklyPlanData | null;
  stats: Stats;
}

export function PlannerDashboard({ initialPlan, stats }: PlannerDashboardProps) {
  const [plan, setPlan] = useState<WeeklyPlanData | null>(initialPlan);
  const [loading, setLoading] = useState(false);

  const refreshPlan = useCallback(async () => {
    const res = await fetch("/api/planner/current");
    if (res.ok) {
      const data = (await res.json()) as WeeklyPlanData;
      setPlan(data);
    }
  }, []);

  const handleGenerate = useCallback(async (preferences?: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences }),
      });
      if (res.ok) {
        await refreshPlan();
      }
    } finally {
      setLoading(false);
    }
  }, [refreshPlan]);

  const handleApproveSlot = useCallback(async (slotId: string) => {
    if (!plan) return;
    const res = await fetch(`/api/planner/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", slotId }),
    });
    if (res.ok) await refreshPlan();
  }, [plan, refreshPlan]);

  const handleRemoveSlot = useCallback(async (slotId: string) => {
    if (!plan) return;
    const res = await fetch(`/api/planner/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", slotId }),
    });
    if (res.ok) await refreshPlan();
  }, [plan, refreshPlan]);

  const handleSwapSlot = useCallback((_day: string) => {
    // Placeholder: open a post-picker modal or navigate to posts page
    // For now just refresh — a future task can wire up a picker
    refreshPlan();
  }, [refreshPlan]);

  const handleClearAll = useCallback(async () => {
    if (!plan) return;
    setLoading(true);
    try {
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      await refreshPlan();
    } finally {
      setLoading(false);
    }
  }, [plan, refreshPlan]);

  const handleScheduleAll = useCallback(async () => {
    if (!plan) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/planner/${plan.id}/schedule`, {
        method: "POST",
      });
      if (res.ok) await refreshPlan();
    } finally {
      setLoading(false);
    }
  }, [plan, refreshPlan]);

  return (
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col md:-m-8">
      {/* Stats bar — compact on mobile so all three numbers stay visible */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 bg-white px-3 py-2 md:gap-6 md:px-8 md:py-3">
        <h1 className="hidden text-base font-bold text-gray-900 md:block">Content Hub</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-600 md:gap-5 md:text-sm">
          <span className="whitespace-nowrap">
            <span className="font-semibold text-gray-900">{stats.totalPosts}</span> posts
          </span>
          <span className="whitespace-nowrap">
            <span className="font-semibold text-green-700">{stats.published}</span> published
          </span>
          <span className="whitespace-nowrap">
            <span className="font-semibold text-blue-700">{stats.scheduled}</span> scheduled
          </span>
        </div>
      </div>

      {/* Two-pane layout — stacked on mobile, side-by-side on md+ */}
      <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-y-auto md:flex-row md:overflow-hidden">
        {/* Left: Weekly plan (full on mobile, 3/5 on md+) */}
        <div className="shrink-0 overflow-hidden p-4 md:w-3/5 md:shrink md:overflow-hidden md:p-6 md:pr-3">
          <WeeklyPlanView
            plan={plan}
            loading={loading}
            onGenerate={handleGenerate}
            onApproveSlot={handleApproveSlot}
            onRemoveSlot={handleRemoveSlot}
            onSwapSlot={handleSwapSlot}
            onClearAll={handleClearAll}
            onScheduleAll={handleScheduleAll}
          />
        </div>

        {/* Right: Link to the new assistant (replaces the old planner chat) */}
        <div className="min-h-[200px] shrink-0 overflow-hidden p-4 md:w-2/5 md:min-h-0 md:shrink md:overflow-hidden md:p-6 md:pl-3">
          <Link
            href="/admin/assistant"
            className="flex h-full min-h-[200px] items-center justify-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:bg-white hover:text-gray-900"
          >
            <Sparkles className="h-4 w-4" />
            Open the Assistant →
          </Link>
        </div>
      </div>
    </div>
  );
}
