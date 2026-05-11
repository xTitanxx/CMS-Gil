"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Layers, Recycle, Sparkles, Loader2, ArrowLeft, Undo2 } from "lucide-react";
import { OneByOneCard } from "./OneByOneCard";
import { BulkPlanPanel } from "./BulkPlanPanel";
import type { NextCandidateResponse, SuggestCandidate, SuggestedSlot } from "./types";

type Mode = "menu" | "one" | "bulk";

interface AcceptedSummary {
  postId: string;
  body: string;
  thumbUrl: string | null;
  day: string;
  hour: number;
  planId: string;
  slotId: string;
}

interface SkippedSummary {
  postId: string;
  body: string;
}

interface UndoState {
  kind: "accept" | "skip";
  postId: string;
  // For accept undo
  planId?: string;
  slotId?: string;
  // For both
  expiresAt: number;
  label: string;
}

const UNDO_WINDOW_MS = 5000;

interface PrefetchedCandidate {
  candidate: SuggestCandidate;
  slot: SuggestedSlot;
  platforms: string[];
  remaining: number;
}

export function SuggesterClient() {
  const [mode, setMode] = useState<Mode>("menu");
  const [mounted, setMounted] = useState(false);

  const [current, setCurrent] = useState<PrefetchedCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedSummary[]>([]);
  const [skipped, setSkipped] = useState<SkippedSummary[]>([]);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  const nextRef = useRef<PrefetchedCandidate | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCandidate = useCallback(async (): Promise<PrefetchedCandidate | null> => {
    const exclude = Array.from(seenRef.current).join(",");
    const url = exclude
      ? `/api/planner/next-candidate?exclude=${exclude}`
      : "/api/planner/next-candidate";
    const res = await fetch(url);
    const data = (await res.json()) as NextCandidateResponse;
    // Check candidate first: null candidate (including "no open slots") → empty state
    if (!data.candidate || !data.suggestedSlot) return null;
    if (data.error) {
      throw new Error(data.error);
    }
    return {
      candidate: data.candidate,
      slot: data.suggestedSlot,
      platforms: data.suggestedPlatforms ?? [],
      remaining: data.remaining,
    };
  }, []);

  const ensureCurrent = useCallback(async () => {
    if (current || loading || inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      let next: PrefetchedCandidate | null = nextRef.current;
      nextRef.current = null;
      if (!next) next = await fetchCandidate();
      if (!next) {
        setEmpty(true);
        setCurrent(null);
        return;
      }
      setCurrent(next);
      setEmpty(false);
      // Kick a background prefetch for the one *after* this.
      void (async () => {
        seenRef.current.add(next.candidate.id);
        try {
          const after = await fetchCandidate();
          seenRef.current.delete(next.candidate.id);
          nextRef.current = after;
        } catch {
          seenRef.current.delete(next.candidate.id);
        }
      })();
    } catch (e) {
      setError(String(e));
      setCurrent(null);
    } finally {
      inFlightRef.current = false;
      setLoading(false);
    }
  }, [current, loading, fetchCandidate]);

  useEffect(() => {
    if (mode === "one" && !current && !empty && !loading && !error) {
      void ensureCurrent();
    }
  }, [mode, current, empty, loading, error, ensureCurrent]);

  useEffect(() => { setMounted(true); }, []);

  // Clear an active undo timer when a new one comes in or component unmounts
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  function startUndoTimer(state: UndoState) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo(state);
    undoTimerRef.current = setTimeout(() => {
      setUndo((u) => (u && u.expiresAt === state.expiresAt ? null : u));
    }, UNDO_WINDOW_MS);
  }

  function dismissUndoNow() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo(null);
  }

  const handleSkip = useCallback(async () => {
    if (!current) return;
    const c = current.candidate;
    seenRef.current.add(c.id);
    setCurrent(null);

    try {
      await fetch("/api/planner/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: c.id }),
      });
    } catch {
      // Network failure → still treat as locally skipped this session.
    }

    setSkipped((prev) => [{ postId: c.id, body: c.body.slice(0, 80) }, ...prev]);
    startUndoTimer({
      kind: "skip",
      postId: c.id,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
      label: "Skipped — sent to Triage",
    });

    void ensureCurrent();
  }, [current, ensureCurrent]);

  const handleAccept = useCallback(
    async (input: { body: string; platforms: string[]; slot: SuggestedSlot }) => {
      if (!current) return;
      const c = current.candidate;

      if (input.body !== c.body) {
        await fetch(`/api/posts/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        });
      }

      // Suggester accept commits a real schedule — propose creates the slot
      // AND the matching PublishRecord in one call. AI/Recycle plans keep the
      // PROPOSED → bulk-schedule flow; the Suggester is per-post and intentional.
      const res = await fetch("/api/planner/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: c.id,
          day: input.slot.day,
          hour: input.slot.hour,
          platforms: input.platforms,
          reasoning: "Approved via one-by-one suggester",
          schedule: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to schedule");
        return;
      }
      const data = (await res.json()) as { planId?: string; slotId?: string };
      if (!data.planId || !data.slotId) {
        setError("Schedule succeeded but no slot returned — undo unavailable.");
      }

      seenRef.current.add(c.id);
      setAccepted((prev) => [
        {
          postId: c.id,
          body: input.body.slice(0, 80),
          thumbUrl: c.thumbUrl,
          day: input.slot.day,
          hour: input.slot.hour,
          planId: data.planId ?? "",
          slotId: data.slotId ?? "",
        },
        ...prev,
      ]);

      if (data.planId && data.slotId) {
        startUndoTimer({
          kind: "accept",
          postId: c.id,
          planId: data.planId,
          slotId: data.slotId,
          expiresAt: Date.now() + UNDO_WINDOW_MS,
          label: `Scheduled ${input.slot.day.slice(5)} · ${input.slot.hour}:00`,
        });
      }

      setCurrent(null);
      void ensureCurrent();
    },
    [current, ensureCurrent]
  );

  const handleUndo = useCallback(async () => {
    if (!undo) return;
    const state = undo;
    dismissUndoNow();

    if (state.kind === "accept" && state.planId && state.slotId) {
      await fetch(`/api/planner/${state.planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", slotId: state.slotId }),
      }).catch(() => {});
      setAccepted((prev) => prev.filter((a) => a.slotId !== state.slotId));
    } else if (state.kind === "skip") {
      await fetch("/api/planner/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: state.postId, undo: true }),
      }).catch(() => {});
      setSkipped((prev) => prev.filter((s) => s.postId !== state.postId));
    }

    seenRef.current.delete(state.postId);
    nextRef.current = null;
    setCurrent(null);
    setEmpty(false);
    void ensureCurrent();
  }, [undo, ensureCurrent]);

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
                  Swipe through suggestions. Right to schedule, left to skip.
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

          {accepted.length > 0 && (
            <Link
              href="/admin/planner"
              className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white p-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-semibold text-gray-900">
                  {accepted.length} scheduled
                </span>{" "}
                this session — review in Planner
              </span>
              <span className="shrink-0 text-gray-400">→</span>
            </Link>
          )}

          {skipped.length > 0 && (
            <div className="mt-2 rounded-xl border border-orange-200 bg-orange-50 p-3">
              <div className="mb-1 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">
                  Skipped this session
                </div>
                <Link
                  href="/admin/triage?bucket=skipped-in-suggester"
                  className="text-[11px] font-semibold text-orange-700 underline-offset-2 hover:underline"
                >
                  Open in Triage →
                </Link>
              </div>
              <p className="text-[11px] text-orange-800">
                {skipped.length} post{skipped.length === 1 ? "" : "s"} flagged for later review.
              </p>
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
  // Portal to document.body so position:fixed isn't clipped by the
  // overflow-y-auto admin <main> on mobile Safari.
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-gradient-to-b from-gray-50 to-white"
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
            {current?.remaining ? `${current.remaining} candidates left` : "Reviewing"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200">
            {accepted.length} scheduled
          </span>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col">
        {loading && !current && (
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
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              onClick={() => setMode("menu")}
              className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Done
            </button>
          </div>
        )}

        {current && !loading && (
          <OneByOneCard
            candidate={current.candidate}
            initialSlot={current.slot}
            initialPlatforms={current.platforms}
            onSkip={handleSkip}
            onAccept={handleAccept}
          />
        )}
      </div>

      {/* Undo snackbar */}
      {undo && (
        <div
          className="pointer-events-none fixed left-1/2 z-40 w-[92%] max-w-md -translate-x-1/2"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
        >
          <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl bg-gray-900 px-4 py-3 text-sm text-white shadow-lg ring-1 ring-black/10">
            <span className="flex-1 truncate">{undo.label}</span>
            <button
              onClick={() => void handleUndo()}
              className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide hover:bg-white/20"
            >
              <Undo2 className="h-3.5 w-3.5" />
              Undo
            </button>
          </div>
        </div>
      )}

    </div>,
    document.body
  );
}
