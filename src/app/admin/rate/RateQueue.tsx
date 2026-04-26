"use client";
import { useEffect, useState, useCallback } from "react";
import { RatingCard } from "./RatingCard";

type Media = { id: string; mimeType: string; url?: string; thumbnailUrl?: string };
type Rating = { stars: number; reasons: string[]; note: string | null };
type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Analytics = {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
  platform: string;
} | null;

type Post = {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
  rating: Rating | null;
  lifecycle: Lifecycle;
  readiness?: string;
  analytics?: Analytics;
};

type PurgeStats = { total: number; archived: number; remaining: number };
type TypeTab = "story" | "video" | "image";

const TABS: { value: TypeTab; label: string; emoji: string }[] = [
  { value: "video", label: "Videos", emoji: "🎬" },
  { value: "image", label: "Images", emoji: "🖼️" },
  { value: "story", label: "Stories", emoji: "📖" },
];

export function RateQueue() {
  const [type, setType] = useState<TypeTab>("video");
  const [queue, setQueue] = useState<Post[]>([]);
  const [purgeStats, setPurgeStats] = useState<PurgeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionCount, setActionCount] = useState(0);

  const refill = useCallback(async (t: TypeTab) => {
    const res = await fetch(`/api/ratings/queue?limit=20&type=${t}&mode=purge`);
    const data = await res.json();
    setQueue((q) => {
      const existingIds = new Set(q.map((p) => p.id));
      const fresh = (data.items as Post[]).filter((p) => !existingIds.has(p.id));
      return [...q, ...fresh];
    });
    if (data.purgeStats) setPurgeStats(data.purgeStats);
    setLoading(false);
  }, []);

  useEffect(() => {
    setQueue([]);
    setLoading(true);
    setActionCount(0);
    refill(type);
  }, [type, refill]);

  useEffect(() => {
    if (!loading && queue.length > 0 && queue.length < 5) refill(type);
  }, [queue.length, loading, type, refill]);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    setActionCount((c) => c + 1);
  }, []);

  const skip = useCallback(() => {
    setQueue((q) => (q.length <= 1 ? q.slice(1) : [...q.slice(1), q[0]]));
  }, []);

  const purgeAction = useCallback(
    async (
      action: "KEEP" | "DELETE" | "TRIAGE",
      ratingData?: { stars: number; reasons: string[]; note: string | null; lifecycle?: Lifecycle },
    ) => {
      const top = queue[0];
      if (!top) return;
      await fetch(`/api/posts/${top.id}/purge-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...ratingData }),
      });
      if (purgeStats) {
        if (action === "DELETE") {
          setPurgeStats({ ...purgeStats, archived: purgeStats.archived + 1, remaining: purgeStats.remaining - 1 });
        }
      }
      advance();
    },
    [queue, advance, purgeStats],
  );

  const top = queue[0];
  const reviewedPct =
    purgeStats && purgeStats.total > 0
      ? Math.round((actionCount / purgeStats.remaining) * 100)
      : 0;

  return (
    <div className="relative min-h-dvh flex flex-col">
      <div
        className="sticky top-0 z-10 bg-white/80 backdrop-blur pl-14 pr-3 pb-3 text-xs space-y-2 md:px-3"
        style={{ paddingTop: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      >
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`flex-1 min-w-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition touch-manipulation ${
                type === t.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
        {purgeStats && (
          <div>
            <div className="flex justify-between mb-1 text-gray-500">
              <span>{actionCount} reviewed this session</span>
              <span>{purgeStats.remaining} remaining</span>
            </div>
            <div className="h-1 rounded bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-[width]"
                style={{ width: `${Math.min(100, reviewedPct)}%` }}
              />
            </div>
          </div>
        )}
      </div>
      {loading ? (
        <div className="p-8 text-center">Loading...</div>
      ) : queue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="text-4xl mb-4">🎉</div>
            <div className="text-xl font-semibold">Queue empty</div>
            <div className="mt-2 text-gray-500">Try another tab above.</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col p-4">
          <RatingCard
            key={top.id}
            post={top}
            onKeep={(rd) => purgeAction("KEEP", rd)}
            onDelete={(rd) => purgeAction("DELETE", rd)}
            onTriage={(rd) => purgeAction("TRIAGE", rd)}
            onSkip={skip}
          />
        </div>
      )}
    </div>
  );
}
