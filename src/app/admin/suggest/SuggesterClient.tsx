"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, Undo2, AlertCircle, RotateCw } from "lucide-react";
import { OneByOneCard } from "./OneByOneCard";
import type { NextCandidateResponse, SuggestCandidate, SuggestedSlot } from "./types";

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
  planId?: string;
  slotId?: string;
  expiresAt: number;
  label: string;
}

const UNDO_WINDOW_MS = 5000;

interface LoadedCandidate {
  candidate: SuggestCandidate;
  slot: SuggestedSlot;
  platforms: string[];
  remaining: number;
}

/**
 * Suggester state machine — kept deliberately simple after the previous
 * design's prefetch caused slot double-booking (a stale prefetched slot was
 * promoted to "current" without re-checking which hour the server now
 * considered free). No prefetch here: every candidate is fetched fresh after
 * the previous one is decided. The ~300ms loading is acceptable; the user
 * pauses to look at the next card anyway.
 */
export function SuggesterClient() {
  const [current, setCurrent] = useState<LoadedCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedSummary[]>([]);
  const [skipped, setSkipped] = useState<SkippedSummary[]>([]);
  const [undo, setUndo] = useState<UndoState | null>(null);

  // IDs whose decision is already recorded this session (accept or skip).
  // Sent as `exclude` so the server doesn't re-offer them.
  const seenRef = useRef<Set<string>>(new Set());
  // Guards against overlapping fetches when multiple effects/handlers race.
  const fetchingRef = useRef(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOne = useCallback(async (): Promise<LoadedCandidate | "empty"> => {
    const exclude = Array.from(seenRef.current).join(",");
    const url = exclude
      ? `/api/planner/next-candidate?exclude=${exclude}`
      : "/api/planner/next-candidate";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`next-candidate ${res.status}`);
    const data = (await res.json()) as NextCandidateResponse;
    // "No open slots in the next 8 weeks" is a soft empty state — show the
    // empty screen instead of treating it as an error so the user gets a
    // sensible CTA.
    if (!data.candidate || !data.suggestedSlot) return "empty";
    if (data.error) throw new Error(data.error);
    return {
      candidate: data.candidate,
      slot: data.suggestedSlot,
      platforms: data.suggestedPlatforms ?? [],
      remaining: data.remaining,
    };
  }, []);

  const loadNext = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchOne();
      if (next === "empty") {
        setCurrent(null);
        setEmpty(true);
      } else {
        setCurrent(next);
        setEmpty(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCurrent(null);
    } finally {
      fetchingRef.current = false;
      setLoading(false);
    }
  }, [fetchOne]);

  // Initial load only — every subsequent load is triggered explicitly by a
  // handler (accept / skip / undo / retry). No effect-based auto-retry so we
  // can't get into a render → fetch → render → fetch loop on transient errors.
  useEffect(() => {
    void loadNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

    try {
      await fetch("/api/planner/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: c.id }),
      });
    } catch {
      // Network failure — still locally skipped this session.
    }

    setSkipped((prev) => [{ postId: c.id, body: c.body.slice(0, 80) }, ...prev]);
    startUndoTimer({
      kind: "skip",
      postId: c.id,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
      label: "Skipped — sent to Triage",
    });

    setCurrent(null);
    void loadNext();
  }, [current, loadNext]);

  const handleAccept = useCallback(
    async (input: { body: string; platforms: string[]; slot: SuggestedSlot }) => {
      if (!current) return;
      const c = current.candidate;
      setError(null);

      if (input.body !== c.body) {
        await fetch(`/api/posts/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: input.body }),
        });
      }

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

      if (res.status === 409) {
        // Race: slot taken between display and accept. Drop the current card
        // (don't mark seen — same post can be rescheduled) and fetch fresh.
        setError("That slot was just taken — picked a fresh one.");
        setCurrent(null);
        void loadNext();
        throw new Error("slot taken");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.error ?? `propose failed (${res.status})`;
        setError(message);
        // Throw so OneByOneCard.fireAccept resets its local state and the
        // user can retry on the same card.
        throw new Error(message);
      }

      const data = (await res.json()) as { planId?: string; slotId?: string };

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
      void loadNext();
    },
    [current, loadNext],
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
    setCurrent(null);
    setEmpty(false);
    void loadNext();
  }, [undo, loadNext]);

  return (
    <div className="-m-4 flex min-h-[calc(100dvh-3.5rem)] flex-col md:-m-8 md:min-h-screen">
      {accepted.length > 0 && (
        <Link
          href="/admin/planner"
          className="fixed right-3 z-30 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
          style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
        >
          {accepted.length} scheduled →
        </Link>
      )}

      <div className="flex flex-1 min-h-0 flex-col">
        {loading && !current && (
          <div className="flex flex-1 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Finding the next post…</span>
          </div>
        )}

        {!loading && error && !current && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-red-50 p-3 ring-1 ring-red-200">
              <AlertCircle className="h-6 w-6 text-red-600" />
            </div>
            <div className="text-base font-semibold text-gray-900">Couldn&apos;t load the next post</div>
            <p className="max-w-[320px] text-sm text-gray-500">{error}</p>
            <button
              onClick={() => void loadNext()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <RotateCw className="h-4 w-4" />
              Try again
            </button>
          </div>
        )}

        {!loading && empty && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="rounded-full bg-emerald-50 p-3 ring-1 ring-emerald-200">
              <Sparkles className="h-6 w-6 text-emerald-600" />
            </div>
            <div className="text-base font-semibold text-gray-900">All caught up</div>
            <p className="max-w-[320px] text-sm text-gray-500">
              No more candidates to schedule right now. Come back later, or open the
              planner to review what&apos;s queued.
            </p>
            <Link
              href="/admin/planner"
              className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Open planner
            </Link>
          </div>
        )}

        {current && (
          <OneByOneCard
            key={current.candidate.id}
            candidate={current.candidate}
            initialSlot={current.slot}
            initialPlatforms={current.platforms}
            onSkip={handleSkip}
            onAccept={handleAccept}
          />
        )}
      </div>

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

      {skipped.length > 0 && (
        <div className="shrink-0 border-t border-orange-100 bg-orange-50 px-4 py-2 md:px-8">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-orange-800">
              <span className="font-semibold">{skipped.length}</span> skipped this session
            </span>
            <Link
              href="/admin/triage?bucket=skipped-in-suggester"
              className="font-semibold text-orange-700 underline-offset-2 hover:underline"
            >
              Open in Triage →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
