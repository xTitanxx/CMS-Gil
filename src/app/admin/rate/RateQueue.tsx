"use client";
import { useEffect, useState, useCallback } from "react";
import { RatingCard } from "./RatingCard";

type Media = { id: string; mimeType: string; url?: string; thumbnailUrl?: string };
type Rating = { stars: number; reasons: string[]; note: string | null };
type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Post = {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
  rating: Rating | null;
  lifecycle: Lifecycle;
};

type Stats = { total: number; rated: number; byStar: Record<number, number> };
type TypeTab = "story" | "video" | "image";

const TABS: { value: TypeTab; label: string; emoji: string }[] = [
  { value: "video", label: "Videos", emoji: "🎬" },
  { value: "image", label: "Images", emoji: "🖼️" },
  { value: "story", label: "Stories", emoji: "📖" },
];

export function RateQueue() {
  const [type, setType] = useState<TypeTab>("video");
  const [queue, setQueue] = useState<Post[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refill = useCallback(async (t: TypeTab) => {
    const res = await fetch(`/api/ratings/queue?limit=20&type=${t}`);
    const data = (await res.json()) as { items: Post[] };
    setQueue((q) => [...q, ...data.items]);
    setLoading(false);
  }, []);

  const refreshStats = useCallback(async () => {
    const res = await fetch("/api/ratings/stats");
    setStats(await res.json());
  }, []);

  useEffect(() => {
    setQueue([]);
    setLoading(true);
    refill(type);
    refreshStats();
  }, [type, refill, refreshStats]);

  useEffect(() => {
    if (!loading && queue.length > 0 && queue.length < 5) refill(type);
  }, [queue.length, loading, type, refill]);

  const advance = useCallback(() => {
    setQueue((q) => q.slice(1));
    refreshStats();
  }, [refreshStats]);

  const skip = useCallback(() => {
    setQueue((q) => (q.length <= 1 ? q.slice(1) : [...q.slice(1), q[0]]));
  }, []);

  const save = useCallback(
    async (payload: { stars: number; reasons: string[]; note: string | null }) => {
      const top = queue[0];
      if (!top) return;
      await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId: top.id, ...payload }),
      });
      advance();
    },
    [queue, advance]
  );

  const top = queue[0];
  const ratedPct = stats && stats.total > 0 ? Math.round((stats.rated / stats.total) * 100) : 0;

  function TypeTabs() {
    return (
      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setType(t.value)}
            className={`flex-1 min-w-0 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
              type === t.value
                ? "bg-yellow-400 text-black"
                : "bg-white/10 text-white/70 hover:bg-white/20"
            }`}
          >
            {t.emoji} {t.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="relative min-h-dvh flex flex-col">
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur p-3 text-xs space-y-2">
        <TypeTabs />
        {stats && (
          <div>
            <div className="flex justify-between mb-1 opacity-70">
              <span>{stats.rated} / {stats.total} rated</span>
              <span>{ratedPct}%</span>
            </div>
            <div className="h-1 rounded bg-white/20 overflow-hidden">
              <div className="h-full bg-yellow-400 transition-[width]" style={{ width: `${ratedPct}%` }} />
            </div>
          </div>
        )}
      </div>
      {loading ? (
        <div className="p-8 text-center">Loading…</div>
      ) : queue.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-8 text-center">
          <div>
            <div className="text-4xl mb-4">🎉</div>
            <div className="text-xl font-semibold">Nothing to rate here</div>
            <div className="mt-2 opacity-70">Try another tab above.</div>
          </div>
        </div>
      ) : (
        <RatingCard key={top.id} post={top} onSave={save} onSkip={skip} />
      )}
    </div>
  );
}
