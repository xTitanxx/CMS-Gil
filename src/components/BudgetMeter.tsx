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
  const pct = Math.min(100, Math.max(0, Math.round(budget.percentUsed)));
  const danger = pct >= 90;
  const warn = !danger && pct >= 75;

  return (
    <div className="px-3 pt-2.5 pb-1">
      <div className="flex items-center justify-between text-[11px] font-medium text-gray-500">
        <span className="uppercase tracking-wide">Monthly allowance</span>
        <span className={danger ? "text-red-600" : warn ? "text-amber-600" : "text-gray-500"}>
          {pct}% · renews {reset}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            danger
              ? "bg-gradient-to-r from-red-500 to-red-600"
              : warn
              ? "bg-gradient-to-r from-amber-400 to-amber-500"
              : "bg-gradient-to-r from-blue-500 to-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
