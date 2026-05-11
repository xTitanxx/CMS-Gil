"use client";

import { useEffect, useState } from "react";

type SubscriberBudget = {
  role: "subscriber";
  unlimited: false;
  percentUsed: number;
  cycleResetsAt: string | null;
};

type AdminBudget = {
  role: "admin";
  unlimited: true;
  monthSpentUsd: number;
  monthLabel: string;
};

type Budget = SubscriberBudget | AdminBudget;

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

  if (!budget) return null;

  if (budget.role === "admin") {
    return (
      <div className="mx-auto flex items-center justify-center gap-2 self-center rounded-full border border-black/5 bg-white/70 px-3 py-1 text-[11px] text-gray-600 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/55">
        <span>API spend ({budget.monthLabel})</span>
        <span className="font-mono font-semibold text-gray-800">
          ${budget.monthSpentUsd.toFixed(2)}
        </span>
      </div>
    );
  }

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
    <div className="rounded-full border border-black/5 bg-white/70 px-3 py-1.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/55">
      <div className="flex items-center justify-between text-[11px] font-medium text-gray-500">
        <span className="uppercase tracking-wide">Monthly allowance</span>
        <span className={danger ? "text-red-600" : warn ? "text-amber-600" : "text-gray-500"}>
          {pct}% · renews {reset}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100/80">
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
