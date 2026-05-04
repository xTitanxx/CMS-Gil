"use client";

import { useEffect, useState, useImperativeHandle, forwardRef, useCallback } from "react";

interface UsageResponse {
  today: number;
  last7Days: number;
  thisMonth: number;
  allTime: number;
}

export interface CostPillHandle {
  refresh: () => void;
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export const CostPill = forwardRef<CostPillHandle>(function CostPill(_, ref) {
  const [usage, setUsage] = useState<UsageResponse | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/assistant/usage", { cache: "no-store" });
      if (!r.ok) return;
      setUsage(await r.json());
    } catch {
      // ignore — counter is non-critical
    }
  }, []);

  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!usage) return null;

  const tip =
    `Today ${formatUsd(usage.today)}\n` +
    `Last 7 days ${formatUsd(usage.last7Days)}\n` +
    `This month ${formatUsd(usage.thisMonth)}\n` +
    `All time ${formatUsd(usage.allTime)}`;

  return (
    <div
      className="flex h-10 items-center rounded-full bg-white/75 px-3 text-[12px] tabular-nums text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55"
      title={tip}
      aria-label={tip}
    >
      <span className="text-gray-500">today</span>
      <span className="ml-1.5 font-medium">{formatUsd(usage.today)}</span>
    </div>
  );
});
