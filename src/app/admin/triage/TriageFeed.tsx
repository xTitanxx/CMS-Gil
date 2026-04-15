"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TriageCard, type TriagePost } from "./TriageCard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CountData {
  total: number;
  byReason: Record<string, number>;
}

interface FeedPage {
  items: TriagePost[];
  nextCursor: string | null;
}

// ─── Filter buckets ───────────────────────────────────────────────────────────

const BUCKETS = [
  { slug: undefined, label: "All" },
  { slug: "silent-video", label: "Silent" },
  { slug: "unchecked-audio", label: "Unchecked" },
  { slug: "empty", label: "Empty" },
  { slug: "share-only", label: "Share-only" },
  { slug: "broken-media", label: "Broken" },
  { slug: "dont-post", label: "Don't-post" },
] as const;

type BucketSlug = (typeof BUCKETS)[number]["slug"];

const TYPE_TABS = [
  { value: "video", label: "Videos", emoji: "🎬" },
  { value: "image", label: "Images", emoji: "🖼️" },
  { value: "story", label: "Stories", emoji: "📖" },
] as const;

type TypeTab = (typeof TYPE_TABS)[number]["value"];

// ─── Toast ────────────────────────────────────────────────────────────────────

interface Toast {
  id: string;
  postId: string;
  message: string;
  savedPost: TriagePost;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  initialBucket?: string;
}

export function TriageFeed({ initialBucket }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeBucket: BucketSlug =
    (BUCKETS.find((b) => b.slug === initialBucket)?.slug) ?? undefined;

  const activeType: TypeTab =
    (TYPE_TABS.find((t) => t.value === searchParams.get("type"))?.value) ?? "video";

  const [counts, setCounts] = useState<CountData | null>(null);
  const [posts, setPosts] = useState<TriagePost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasFetched = useRef(false);

  // ── Count polling ──

  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/triage/count");
      if (res.ok) setCounts(await res.json());
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void fetchCounts();
    const interval = setInterval(fetchCounts, 60_000);
    return () => clearInterval(interval);
  }, [fetchCounts]);

  // ── Feed fetching ──

  const fetchPage = useCallback(
    async (cursor?: string) => {
      const params = new URLSearchParams();
      if (activeBucket) params.set("bucket", activeBucket);
      if (activeType) params.set("type", activeType);
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/triage?${params}`);
      if (!res.ok) throw new Error("Failed to fetch triage");
      return (await res.json()) as FeedPage;
    },
    [activeBucket, activeType]
  );

  // Initial load / bucket change
  useEffect(() => {
    hasFetched.current = false;
    setLoading(true);
    setPosts([]);
    setNextCursor(null);

    fetchPage()
      .then((data) => {
        setPosts(data.items);
        setNextCursor(data.nextCursor);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        hasFetched.current = true;
      });
  }, [fetchPage]);

  // ── Infinite scroll ──

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          setLoadingMore(true);
          fetchPage(nextCursor)
            .then((data) => {
              setPosts((prev) => [...prev, ...data.items]);
              setNextCursor(data.nextCursor);
            })
            .catch(() => {})
            .finally(() => setLoadingMore(false));
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  // ── Bucket navigation ──

  function selectBucket(slug: BucketSlug) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set("bucket", slug);
    else params.delete("bucket");
    router.push(`${pathname}?${params.toString()}`);
  }

  function selectType(t: TypeTab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("type", t);
    router.push(`${pathname}?${params.toString()}`);
  }

  // ── Dismiss (optimistic) ──

  function dismissPost(postId: string, action: "mark-ready" | "archive" | "trash") {
    const saved = posts.find((p) => p.id === postId);
    if (!saved) return;

    // Remove from list
    setPosts((prev) => prev.filter((p) => p.id !== postId));

    // Update counts optimistically
    setCounts((prev) => {
      if (!prev) return prev;
      const newByReason = { ...prev.byReason };
      for (const r of saved.notReadyReasons) {
        if (newByReason[r]) newByReason[r] = Math.max(0, newByReason[r] - 1);
      }
      return { total: Math.max(0, prev.total - 1), byReason: newByReason };
    });

    // Toast with undo (not for trash — that's destructive and confirmed)
    if (action !== "trash") {
      const toastId = `${postId}-${Date.now()}`;
      const message =
        action === "mark-ready" ? "Marked ready" : "Archived";
      const toast: Toast = { id: toastId, postId, message, savedPost: saved };
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 5000);
    }
  }

  async function undoDismiss(toast: Toast) {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    // Refetch the post to restore it
    try {
      const res = await fetch(`/api/triage?cursor=`);
      if (!res.ok) return;
      // Simpler: just re-add the saved post to the top of the list
      setPosts((prev) => [toast.savedPost, ...prev]);
      setCounts((prev) => {
        if (!prev) return prev;
        const newByReason = { ...prev.byReason };
        for (const r of toast.savedPost.notReadyReasons) {
          newByReason[r] = (newByReason[r] ?? 0) + 1;
        }
        return { total: prev.total + 1, byReason: newByReason };
      });
    } catch {
      // silent
    }
  }

  // ── Count label helper ──

  function countFor(slug: BucketSlug): number {
    if (!counts) return 0;
    if (!slug) return counts.total;
    return counts.byReason[slug] ?? 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="relative">
      {/* Type tabs */}
      <div className="mb-3 flex gap-2">
        {TYPE_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => selectType(t.value)}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              activeType === t.value
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>

      {/* Filter pills */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {BUCKETS.map(({ slug, label }) => {
          const count = countFor(slug);
          const active = activeBucket === slug;
          return (
            <button
              key={slug ?? "all"}
              onClick={() => selectBucket(slug)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              {label}
              {count > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    active ? "bg-white/20 text-white" : "bg-gray-300 text-gray-700"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-40 animate-pulse rounded-2xl bg-gray-100"
            />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <span className="mb-3 text-5xl">🎉</span>
          <p className="text-lg font-semibold text-gray-800">All clear!</p>
          <p className="mt-1 text-sm text-gray-500">
            No posts need attention{activeBucket ? ` in this bucket` : ""}.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <TriageCard key={post.id} post={post} onDismiss={dismissPost} />
          ))}
          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} className="h-1" />
          {loadingMore && (
            <div className="py-4 text-center text-sm text-gray-400">
              Loading more…
            </div>
          )}
        </div>
      )}

      {/* Toast rack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"
            >
              <span>{t.message}</span>
              <button
                onClick={() => void undoDismiss(t)}
                className="font-semibold text-blue-300 hover:text-blue-200"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
