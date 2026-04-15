"use client";
import { useEffect, useState, useCallback } from "react";
import { RatingCard } from "./RatingCard";

type Media = { id: string; mimeType: string; url?: string; thumbnailUrl?: string };
type Rating = { stars: number; reasons: string[]; note: string | null };
type Post = {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
  rating: Rating | null;
};

type Stats = { total: number; rated: number; byStar: Record<number, number> };

export function RateQueue() {
  const [queue, setQueue] = useState<Post[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const refill = useCallback(async () => {
    const res = await fetch("/api/ratings/queue?limit=20");
    const data = (await res.json()) as { items: Post[] };
    setQueue((q) => [...q, ...data.items]);
    setLoading(false);
  }, []);

  const refreshStats = useCallback(async () => {
    const res = await fetch("/api/ratings/stats");
    setStats(await res.json());
  }, []);

  useEffect(() => { refill(); refreshStats(); }, [refill, refreshStats]);

  useEffect(() => {
    if (queue.length > 0 && queue.length < 5) refill();
  }, [queue.length, refill]);

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

  if (loading) return <div className="p-8 text-center">Loading…</div>;
  if (queue.length === 0)
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div>
          <div className="text-4xl mb-4">🎉</div>
          <div className="text-xl font-semibold">All rated!</div>
          <div className="mt-2 opacity-70">Come back later for new posts to rate.</div>
        </div>
      </div>
    );

  const top = queue[0];
  const ratedPct = stats && stats.total > 0 ? Math.round((stats.rated / stats.total) * 100) : 0;

  return (
    <div className="relative min-h-dvh flex flex-col">
      <div className="sticky top-0 z-10 bg-black/80 backdrop-blur p-3 text-xs">
        {stats && (
          <>
            <div className="flex justify-between mb-1 opacity-70">
              <span>{stats.rated} / {stats.total} rated</span>
              <span>{ratedPct}%</span>
            </div>
            <div className="h-1 rounded bg-white/20 overflow-hidden">
              <div className="h-full bg-yellow-400 transition-[width]" style={{ width: `${ratedPct}%` }} />
            </div>
          </>
        )}
      </div>
      <RatingCard key={top.id} post={top} onSave={save} onSkip={skip} />
    </div>
  );
}
