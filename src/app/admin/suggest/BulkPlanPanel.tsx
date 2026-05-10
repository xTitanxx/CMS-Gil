"use client";

import { useState } from "react";
import Link from "next/link";
import { Recycle, Sparkles, Loader2, Minus, Plus, ArrowRight, Check, AlertCircle } from "lucide-react";

type Mode = "AI" | "DUMB";

const PRESETS = [
  { value: 4, label: "1 day", caption: "4 slots" },
  { value: 12, label: "3 days", caption: "12 slots" },
  { value: 28, label: "1 week", caption: "28 slots" },
  { value: 56, label: "2 weeks", caption: "56 slots" },
];

export function BulkPlanPanel() {
  const [mode, setMode] = useState<Mode>("DUMB");
  const [count, setCount] = useState(7);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, numSlots: count }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const filled = Array.isArray(data.picks) ? data.picks.length : count;
        setResult({ ok: true, message: `Filled ${filled} slot${filled === 1 ? "" : "s"}` });
      } else {
        setResult({ ok: false, message: data.error ?? "Failed to generate plan" });
      }
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    } finally {
      setRunning(false);
    }
  }

  const ModeButton = ({
    value,
    icon: Icon,
    label,
    desc,
  }: {
    value: Mode;
    icon: typeof Recycle;
    label: string;
    desc: string;
  }) => (
    <button
      onClick={() => setMode(value)}
      className={`flex flex-1 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
        mode === value
          ? value === "AI"
            ? "border-purple-500 bg-purple-50 ring-2 ring-purple-200"
            : "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={`h-4 w-4 ${mode === value ? (value === "AI" ? "text-purple-600" : "text-emerald-600") : "text-gray-500"}`} />
        <span className={`text-sm font-semibold ${mode === value ? "text-gray-900" : "text-gray-700"}`}>{label}</span>
      </div>
      <p className="text-[11px] leading-snug text-gray-500">{desc}</p>
    </button>
  );

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Method</div>
        <div className="flex gap-2">
          <ModeButton value="DUMB" icon={Recycle} label="Recycle" desc="Oldest unpublished posts, in order." />
          <ModeButton value="AI" icon={Sparkles} label="AI plan" desc="Claude picks posts that pair with the queue." />
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">How many slots</div>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setCount(p.value)}
              className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors ${
                count === p.value
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <span className="text-sm font-semibold">{p.label}</span>
              <span className={`text-[11px] ${count === p.value ? "text-gray-300" : "text-gray-500"}`}>
                {p.caption}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-500">Custom</span>
          <button
            onClick={() => setCount((c) => Math.max(1, c - 1))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
            aria-label="Decrease"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            min={1}
            max={56}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(56, Number(e.target.value) || 1)))}
            className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-center text-base font-semibold focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
          />
          <button
            onClick={() => setCount((c) => Math.min(56, c + 1))}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 active:bg-gray-200"
            aria-label="Increase"
          >
            <Plus className="h-4 w-4" />
          </button>
          <span className="ml-auto text-[11px] text-gray-400">max 56</span>
        </div>
      </div>

      <button
        onClick={handleRun}
        disabled={running}
        className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-base font-semibold text-white shadow-sm transition-all disabled:opacity-60 ${
          mode === "AI" ? "bg-purple-600 hover:bg-purple-700" : "bg-emerald-600 hover:bg-emerald-700"
        }`}
      >
        {running ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : mode === "AI" ? (
          <Sparkles className="h-5 w-5" />
        ) : (
          <Recycle className="h-5 w-5" />
        )}
        {running ? "Filling…" : `Fill ${count} slot${count === 1 ? "" : "s"}`}
      </button>

      {result && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${
            result.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {result.ok ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          )}
          <span className="flex-1">{result.message}</span>
        </div>
      )}

      <Link
        href="/admin/dashboard"
        className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        Open the calendar
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
