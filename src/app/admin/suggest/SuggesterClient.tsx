"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Layers, Recycle, Sparkles, Loader2, ArrowLeft } from "lucide-react";
import { OneByOneCard } from "./OneByOneCard";
import { BulkPlanPanel } from "./BulkPlanPanel";
import { PushOptIn } from "@/components/PushOptIn";
import type { NextCandidateResponse, SuggestCandidate, SuggestedSlot } from "./types";

type Mode = "menu" | "one" | "bulk";

interface AcceptedSummary {
  postId: string;
  body: string;
  thumbUrl: string | null;
  day: string;
  hour: number;
}

export function SuggesterClient() {
  const [mode, setMode] = useState<Mode>("menu");

  // One-by-one state
  const [candidate, setCandidate] = useState<SuggestCandidate | null>(null);
  const [slot, setSlot] = useState<SuggestedSlot | null>(null);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [remaining, setRemaining] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedSummary[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  const fetchNext = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const exclude = Array.from(seenRef.current).join(",");
      const url = exclude ? `/api/planner/next-candidate?exclude=${exclude}` : "/api/planner/next-candidate";
      const res = await fetch(url);
      const data = (await res.json()) as NextCandidateResponse;
      if (data.error) {
        setError(data.error);
        setCandidate(null);
        setEmpty(true);
        return;
      }
      if (!data.candidate || !data.suggestedSlot) {
        setCandidate(null);
        setEmpty(true);
        return;
      }
      setCandidate(data.candidate);
      setSlot(data.suggestedSlot);
      setPlatforms(data.suggestedPlatforms ?? []);
      setRemaining(data.remaining);
      setEmpty(false);
    } catch (e) {
      setError(String(e));
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "one" && !candidate && !loading && !empty) {
      void fetchNext();
    }
  }, [mode, candidate, loading, empty, fetchNext]);

  const handleSkip = useCallback(() => {
    if (candidate) seenRef.current.add(candidate.id);
    setCandidate(null);
    void fetchNext();
  }, [candidate, fetchNext]);

  const handleAccept = useCallback(
    async (input: { body: string; platforms: string[]; slot: SuggestedSlot }) => {
      if (!candidate) return;
      // Save body edits if changed
      if (input.body !== candidate.body) {
        await fetch(`/api/posts/${candidate.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        });
      }

      const res = await fetch("/api/planner/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: candidate.id,
          day: input.slot.day,
          hour: input.slot.hour,
          platforms: input.platforms,
          reasoning: "Approved via one-by-one suggester",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to schedule");
        return;
      }

      seenRef.current.add(candidate.id);
      setAccepted((prev) => [
        {
          postId: candidate.id,
          body: input.body.slice(0, 80),
          thumbUrl: candidate.thumbUrl,
          day: input.slot.day,
          hour: input.slot.hour,
        },
        ...prev,
      ]);
      setCandidate(null);
      void fetchNext();
    },
    [candidate, fetchNext]
  );

  if (mode === "menu") {
    return (
      <div className="-m-4 flex min-h-[calc(100vh-3.5rem)] flex-col bg-gradient-to-b from-gray-50 to-white md:-m-8">
        <div
          className="px-4 pt-3 pb-2 pl-14 md:pl-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
        >
          <h1 className="text-lg font-bold text-gray-900 md:text-xl">Suggester</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Plan posts, one swipe at a time or in bulk.
          </p>
        </div>

        <div className="flex flex-1 flex-col gap-3 p-4 md:p-8">
          <PushOptIn compact />
          <button
            onClick={() => setMode("one")}
            className="group relative overflow-hidden rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 to-white p-5 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-purple-600 p-2.5 text-white shadow-sm">
                <Layers className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-gray-900">One by one</div>
                <p className="mt-1 text-sm text-gray-600">
                  Review each suggestion fullscreen. Edit, approve, or skip.
                </p>
              </div>
            </div>
          </button>

          <button
            onClick={() => setMode("bulk")}
            className="group relative overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 text-left shadow-sm transition-all hover:shadow-md active:scale-[0.99]"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-emerald-600 p-2.5 text-white shadow-sm">
                <Recycle className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="text-base font-semibold text-gray-900">Bulk plan</div>
                <p className="mt-1 text-sm text-gray-600">
                  Fill many slots at once with the recycle queue or AI.
                </p>
              </div>
            </div>
          </button>

          <Link
            href="/admin/dashboard"
            className="mt-2 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Sparkles className="h-4 w-4" />
            Open the calendar
          </Link>

          {accepted.length > 0 && (
            <div className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Just scheduled
              </div>
              <div className="space-y-1.5">
                {accepted.slice(0, 5).map((a) => (
                  <div key={a.postId} className="flex items-center gap-2 text-xs text-gray-700">
                    <span className="text-gray-400">{a.day}</span>
                    <span className="font-medium">{a.hour}:00</span>
                    <span className="truncate text-gray-600">— {a.body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (mode === "bulk") {
    return (
      <div className="-m-4 flex min-h-[calc(100vh-3.5rem)] flex-col bg-white md:-m-8">
        <div
          className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 pl-14 md:pl-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
        >
          <button
            onClick={() => setMode("menu")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-semibold text-gray-900">Bulk plan</h1>
        </div>
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <BulkPlanPanel />
        </div>
      </div>
    );
  }

  // mode === "one"
  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-gradient-to-b from-gray-50 to-white"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 bg-white/80 px-3 py-2 backdrop-blur">
        <button
          onClick={() => setMode("menu")}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex flex-col items-center text-center">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            One by one
          </span>
          <span className="text-[11px] text-gray-400">
            {remaining > 0 ? `${remaining} candidates left` : "Reviewing"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200">
            {accepted.length} scheduled
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col">
        {loading && !candidate && (
          <div className="flex flex-1 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Finding the next post…</span>
          </div>
        )}

        {empty && !loading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <Sparkles className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="text-base font-semibold text-gray-900">All caught up</div>
            <p className="max-w-[280px] text-sm text-gray-500">
              No more candidates available right now. Come back later or open the bulk planner.
            </p>
            {error && (
              <p className="text-xs text-red-600">{error}</p>
            )}
            <button
              onClick={() => setMode("menu")}
              className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}

        {candidate && slot && !loading && (
          <OneByOneCard
            candidate={candidate}
            initialSlot={slot}
            initialPlatforms={platforms}
            onSkip={handleSkip}
            onAccept={handleAccept}
          />
        )}
      </div>

      {accepted.length > 0 && (
        <div className="shrink-0 border-t border-gray-100 bg-white px-3 py-2">
          <div className="flex items-center gap-2 overflow-x-auto">
            {accepted.slice(0, 6).map((a) => (
              <div
                key={a.postId}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] text-emerald-700 ring-1 ring-emerald-200"
              >
                <span className="font-semibold">{a.day.slice(5)}</span>
                <span>·</span>
                <span>{a.hour}:00</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
