"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkles, Check, X, Loader2 } from "lucide-react";

interface Item {
  postId: string;
  body: string;
  suggestion: string;
  quality: number | null;
  evergreen: boolean | null;
  tags: string[];
  thumbUrl: string | null;
}

interface Page {
  items: Item[];
  nextCursor: string | null;
  total: number;
}

export function ImprovementsFeed() {
  const [items, setItems] = useState<Item[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/triage/improvements?${params}`);
    if (!res.ok) throw new Error("fetch failed");
    return (await res.json()) as Page;
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage()
      .then((p) => {
        setItems(p.items);
        setNextCursor(p.nextCursor);
        setTotal(p.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || loadingMore) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && nextCursor && !loadingMore) {
        setLoadingMore(true);
        fetchPage(nextCursor)
          .then((p) => {
            setItems((prev) => [...prev, ...p.items]);
            setNextCursor(p.nextCursor);
          })
          .catch(() => {})
          .finally(() => setLoadingMore(false));
      }
    }, { rootMargin: "300px" });
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  async function accept(postId: string) {
    setBusy(postId);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((p) => p.postId !== postId));
      setTotal((t) => Math.max(0, t - 1));
    }
  }

  async function dismiss(postId: string) {
    setBusy(postId);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      setItems((prev) => prev.filter((p) => p.postId !== postId));
      setTotal((t) => Math.max(0, t - 1));
    }
  }

  const Header = (
    <div className="mb-4">
      <h1 className="text-xl font-bold text-gray-900 md:text-2xl">AI suggestions</h1>
      <p className="text-sm text-gray-500">
        AI-suggested caption rewrites for low-quality or non-evergreen posts.
      </p>
    </div>
  );

  if (loading) {
    return (
      <div>
        {Header}
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-48 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div>
        {Header}
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Sparkles className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-lg font-semibold text-gray-800">No improvements pending.</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Ask the assistant to run caption analysis, or run it against selected posts. Only
            low-quality or non-evergreen captions get suggestions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {Header}
      <p className="mb-3 text-xs text-gray-500">{total} post{total === 1 ? "" : "s"} with pending suggestions</p>
      <div className="space-y-4">
        {items.map((it) => (
          <div key={it.postId} className="overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 shadow-sm">
            <div className="flex gap-3 p-4">
              {it.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumbUrl} alt="" className="h-16 w-16 flex-shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="h-16 w-16 flex-shrink-0 rounded-lg bg-amber-100" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {it.quality != null && (
                    <span className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-amber-900">
                      quality {it.quality}/5
                    </span>
                  )}
                  {it.evergreen === false && (
                    <span className="rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-amber-900">
                      non-evergreen
                    </span>
                  )}
                  <Link
                    href={`/admin/posts/${it.postId}`}
                    className="ml-auto text-xs text-amber-700 hover:underline"
                  >
                    Open post ↗
                  </Link>
                </div>
              </div>
            </div>
            <div className="grid gap-3 border-t border-amber-200 p-4 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Current</p>
                <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-200 bg-white/70 p-2 text-sm text-gray-700">
                  {it.body}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700">Suggested</p>
                <p className="mt-1 whitespace-pre-wrap rounded-md border border-amber-200 bg-white p-2 text-sm text-gray-900">
                  {it.suggestion}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-amber-200 bg-white/40 px-4 py-3">
              <button
                onClick={() => accept(it.postId)}
                disabled={busy === it.postId}
                className="flex items-center gap-1 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy === it.postId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Accept
              </button>
              <button
                onClick={() => dismiss(it.postId)}
                disabled={busy === it.postId}
                className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </button>
            </div>
          </div>
        ))}
        <div ref={sentinelRef} className="h-1" />
        {loadingMore && (
          <div className="py-4 text-center text-sm text-gray-400">Loading more…</div>
        )}
      </div>
    </div>
  );
}
