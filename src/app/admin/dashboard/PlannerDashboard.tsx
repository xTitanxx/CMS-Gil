"use client";

import { useState, useCallback } from "react";
import { WeeklyPlanView } from "./WeeklyPlanView";
import { PlannerChat } from "./PlannerChat";
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
      {/* Stats bar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 md:gap-6 md:px-8">
        <h1 className="text-base font-bold text-gray-900">Content Hub</h1>
        <div className="flex items-center gap-3 text-sm text-gray-600 md:gap-5">
          <span>
            <span className="font-semibold text-gray-900">{stats.totalPosts}</span> posts
          </span>
          <span>
            <span className="font-semibold text-green-700">{stats.published}</span> published
          </span>
          <span>
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
            onScheduleAll={handleScheduleAll}
          />
        </div>

        {/* Right: Planner chat (full on mobile, 2/5 on md+) */}
        <div className="min-h-[400px] shrink-0 overflow-hidden p-4 md:w-2/5 md:min-h-0 md:shrink md:overflow-hidden md:p-6 md:pl-3">
          {plan ? (
            <PlannerChat planId={plan.id} onPlanUpdated={refreshPlan} />
          ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-sm text-gray-400">
              Generate a plan to start chatting
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
