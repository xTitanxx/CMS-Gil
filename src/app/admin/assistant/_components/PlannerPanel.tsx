"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { WeeklyPlanView } from "../../planner/WeeklyPlanView";
import type { WeeklyPlanData } from "@/lib/planner/types";

export interface PlannerPanelHandle {
  refresh: () => Promise<void>;
}

export const PlannerPanel = forwardRef<PlannerPanelHandle>(function PlannerPanel(_props, ref) {
  const [plan, setPlan] = useState<WeeklyPlanData | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshPlan = useCallback(async () => {
    const res = await fetch("/api/planner/current");
    if (res.ok) setPlan((await res.json()) as WeeklyPlanData);
  }, []);

  useImperativeHandle(ref, () => ({ refresh: refreshPlan }), [refreshPlan]);

  useEffect(() => {
    void refreshPlan().finally(() => setLoading(false));
  }, [refreshPlan]);

  const handleGenerate = useCallback(async (preferences?: string, mode?: "AI" | "DUMB", numSlots?: number) => {
    setLoading(true);
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences, mode, numSlots: numSlots ?? 7 }),
      });
      if (res.ok) await refreshPlan();
    } finally {
      setLoading(false);
    }
  }, [refreshPlan]);

  const handleApproveSlot = useCallback(
    async (slotId: string) => {
      if (!plan) return;
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", slotId }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan]
  );

  const handleRemoveSlot = useCallback(
    async (slotId: string) => {
      if (!plan) return;
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", slotId }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan]
  );

  const handleSwapSlot = useCallback(
    (_day: string) => {
      void refreshPlan();
    },
    [refreshPlan]
  );

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
      await fetch(`/api/planner/${plan.id}/schedule`, { method: "POST" });
      await refreshPlan();
    } finally {
      setLoading(false);
    }
  }, [plan, refreshPlan]);

  return (
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
  );
});
