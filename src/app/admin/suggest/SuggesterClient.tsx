"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, Undo2 } from "lucide-react";
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

export function SuggesterClient() {
  const [current, setCurrent] = useState<LoadedCandidate | null>(null);
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<AcceptedSummary[]>([]);
  const [skipped, setSkipped] = useState<SkippedSummary[]>([]);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  // Prefetched *candidate* (without slot). Slot is always refetched at promotion
  // time because an accept consumes the suggester's current slot and the
  // server-side "next free slot" advances by one — a stale prefetched slot
  // caused the suggester to suggest the same hour to two consecutive posts,
  // and propose silently overwrote the earlier one.
  const nextCandidateRef = useRef<LoadedCandidate | null>(null);
  const inFlightRef = useRef<boolean>(false);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCandidate = useCallback(async (): Promise<LoadedCandidate | null> => {
    const exclude = Array.from(seenRef.current).join(",");
    const url = exclude
      ? `/api/planner/next-candidate?exclude=${exclude}`
      : "/api/planner/next-candidate";
    const res = await fetch(url);
    const data = (await res.json()) as NextCandidateResponse;
    if (!data.candidate || !data.suggestedSlot) return null;
    if (data.error) throw new Error(data.error);
    return {
      candidate: data.candidate,
      slot: data.suggestedSlot,
      platforms: data.suggestedPlatforms ?? [],
      remaining: data.remaining,
    };
  }, []);

  // Refresh just the slot for an already-loaded candidate. Used after an accept
  // (which consumed the previous slot) so the prefetched candidate gets a fresh
  // slot before being shown to the user.
  const refreshSlotFor = useCallback(
    async (cand: LoadedCandidate): Promise<LoadedCandidate | null> => {
      const fresh = await fetchCandidate();
      if (!fresh) return null;
      // If the server now returns a different earliest candidate (e.g. the
      // previously seen exclusion list shifted), trust the server — just use
      // its candidate too.
      return fresh;
    },
    [fetchCandidate],
  );

  const ensureCurrent = useCallback(
    async (opts: { stale?: boolean } = {}) => {
      if (current || loading || inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      setError(null);
      try {
        let next: LoadedCandidate | null = null;
        const prefetched = nextCandidateRef.current;
        nextCandidateRef.current = null;
        if (prefetched && !opts.stale) {
          next = prefetched;
        } else if (prefetched && opts.stale) {
          next = await refreshSlotFor(prefetched);
        } else {
          next = await fetchCandidate();
        }
        if (!next) {
          setEmpty(true);
          setCurrent(null);
          return;
        }
        setCurrent(next);
        setEmpty(false);
        // Background prefetch for the *next* candidate (after this one). We
        // tentatively add this candidate's id to seenRef so the prefetch
        // returns a different one; we restore seenRef afterwards because the
        // user hasn't actually decided yet.
        void (async () => {
          seenRef.current.add(next!.candidate.id);
          try {
            const after = await fetchCandidate();
            nextCandidateRef.current = after;
          } catch {
            // swallow — prefetch failures aren't user-visible
          } finally {
            seenRef.current.delete(next!.candidate.id);
          }
        })();
      } catch (e) {
        setError(String(e));
        setCurrent(null);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [current, loading, fetchCandidate, refreshSlotFor],
  );

  useEffect(() => {
    if (!current && !empty && !loading && !error) {
      void ensureCurrent();
    }
  }, [current, empty, loading, error, ensureCurrent]);

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
      // Network failure → still locally skipped this session.
    }

    setSkipped((prev) => [{ postId: c.id, body: c.body.slice(0, 80) }, ...prev]);
    startUndoTimer({
      kind: "skip",
      postId: c.id,
      expiresAt: Date.now() + UNDO_WINDOW_MS,
      label: "Skipped — sent to Triage",
    });

    // Slot wasn't consumed; prefetched candidate's slot is still valid.
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
        // Slot got taken between display and accept (e.g. parallel tab).
        // Drop the prefetched next (its slot may also be stale) and refetch
        // fresh so the user sees a new free slot for the same candidate.
        nextCandidateRef.current = null;
        setError("That slot was just taken — picked a fresh one.");
        setCurrent(null);
        void ensureCurrent({ stale: true });
        return;
      }
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
      // The slot we just used is no longer free → refresh the prefetched
      // candidate's slot before showing it.
      void ensureCurrent({ stale: true });
    },
    [current, ensureCurrent],
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
    nextCandidateRef.current = null;
    setCurrent(null);
    setEmpty(false);
    // Undo freed a slot; refetch fresh.
    void ensureCurrent({ stale: true });
  }, [undo, ensureCurrent]);

  return (
    <div className="-m-4 flex min-h-[calc(100dvh-3.5rem)] flex-col md:-m-8 md:min-h-[calc(100dvh-0px)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 bg-white/90 px-4 py-2 pl-14 backdrop-blur md:px-8 md:pl-8 md:py-3">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-gray-900 md:text-lg">
            Suggester
          </h1>
          <p className="text-[11px] text-gray-500 md:text-xs">
            {current?.remaining
              ? `${current.remaining} candidates left`
              : loading
                ? "Loading…"
                : empty
                  ? "All caught up"
                  : "Reviewing"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accepted.length > 0 && (
            <Link
              href="/admin/planner"
              className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 sm:inline-flex"
            >
              {accepted.length} scheduled →
            </Link>
          )}
          {accepted.length > 0 && (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 sm:hidden">
              {accepted.length}
            </span>
          )}
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
            <p className="max-w-[320px] text-sm text-gray-500">
              No more candidates to schedule right now. Come back later, or open the
              planner to review what&apos;s queued.
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <Link
              href="/admin/planner"
              className="mt-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Open planner
            </Link>
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
