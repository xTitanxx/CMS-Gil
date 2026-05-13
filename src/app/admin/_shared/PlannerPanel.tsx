"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { WeeklyPlanView } from "../planner/WeeklyPlanView";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

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

  const handleScheduleSlot = useCallback(
    async (slotId: string) => {
      if (!plan) return;
      await fetch(`/api/planner/${plan.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds: [slotId] }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan],
  );

  const handleUnscheduleSlot = useCallback(
    async (slot: PlanSlotData) => {
      if (!plan) return;
      // Virtual orphan-publish slots are cancelled per record; real plan
      // slots go through the planner PATCH which handles the slot status +
      // any associated PublishRecord in one call.
      if (slot.publishRecordIds && slot.publishRecordIds.length > 0) {
        await Promise.all(
          slot.publishRecordIds.map((id) =>
            fetch(`/api/publish/${id}/cancel`, { method: "POST" }),
          ),
        );
        await refreshPlan();
        return;
      }
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", slotId: slot.id }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan],
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

  const handleBodyChange = useCallback((postId: string, body: string) => {
    setPlan((p) => {
      if (!p) return p;
      return {
        ...p,
        slots: p.slots.map((s) =>
          s.post.id === postId ? { ...s, post: { ...s.post, body } } : s,
        ),
      };
    });
  }, []);

  return (
    <WeeklyPlanView
      plan={plan}
      loading={loading}
      onScheduleSlot={handleScheduleSlot}
      onUnscheduleSlot={handleUnscheduleSlot}
      onClearAll={handleClearAll}
      onScheduleAll={handleScheduleAll}
      onBodyChange={handleBodyChange}
    />
  );
});
