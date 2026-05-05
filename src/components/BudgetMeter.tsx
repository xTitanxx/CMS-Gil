"use client";

import { useEffect, useState } from "react";

type Budget = {
  unlimited: boolean;
  percentUsed: number;
  cycleResetsAt: string | null;
};

export function BudgetMeter({ refreshKey = 0 }: { refreshKey?: number }) {
  const [budget, setBudget] = useState<Budget | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/chat/budget");
      if (!res.ok) return;
      const data = (await res.json()) as Budget;
      if (!cancelled) setBudget(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (!budget || budget.unlimited) return null;

  const reset = budget.cycleResetsAt
    ? new Date(budget.cycleResetsAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "soon";
  const pct = Math.round(budget.percentUsed);

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-600">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span>Monthly chat allowance: {pct}% used. Renews {reset}.</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : "bg-blue-500"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
