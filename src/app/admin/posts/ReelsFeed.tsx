"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Volume2, VolumeX } from "lucide-react";
import { ViewToggle } from "./ViewToggle";
import { KindTabs } from "./KindTabs";

interface ReelItem {
  id: string;
  body: string;
  originalDate: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  isVideo: boolean;
  media: { id: string; mimeType: string; hasAudio: boolean | null }[];
}

export function ReelsFeed() {
  const [reels, setReels] = useState<ReelItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(async (cursor: string | null) => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ kind: "reels", limit: "15" });
      if (cursor) qs.set("cursor", cursor);
      const res = await fetch(`/api/posts?${qs.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        posts: ReelItem[];
        nextCursor: string | null;
      };
      setReels((prev) => (cursor ? [...prev, ...data.posts] : data.posts));
      setNextCursor(data.nextCursor);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchPage(null);
  }, [fetchPage]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !isLoadingRef.current) {
            fetchPage(nextCursor);
          }
        }
      },
      { root: el.parentElement, rootMargin: "600px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, fetchPage]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="hidden text-2xl font-bold text-gray-900 md:block">All Reels</h1>
          <p className="text-sm text-gray-500">
            {reels.length > 0 ? `${reels.length} loaded` : "Reels"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Link href="/admin/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      <KindTabs current="posts" />

      {loading && reels.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl bg-black/5">
          <p className="text-sm text-gray-500">Loading reels…</p>
        </div>
      ) : reels.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-gray-500">No reels found.</p>
        </div>
      ) : (
        <div
          className="relative flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl bg-black"
          style={{ scrollSnapStop: "always" }}
        >
          {reels.map((r) => (
            <ReelSlide key={r.id} reel={r} muted={muted} />
          ))}
          {nextCursor && (
            <div ref={sentinelRef} className="h-px" aria-hidden="true" />
          )}
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className="sticky bottom-4 left-full z-20 mr-4 inline-flex h-10 w-10 -translate-x-full items-center justify-center rounded-full bg-white/15 text-white backdrop-blur hover:bg-white/30"
            aria-label={muted ? "Unmute" : "Mute"}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
        </div>
      )}
    </div>
  );
}

function ReelSlide({ reel, muted }: { reel: ReelItem; muted: boolean }) {
  const ref = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.intersectionRatio > 0.6);
      },
      { root: el.parentElement, threshold: [0, 0.6, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (visible) {
      v.currentTime = 0;
      v.play().catch(() => {
        if (!v.muted) {
          v.muted = true;
          v.play().catch(() => {});
        }
      });
    } else {
      v.pause();
    }
  }, [visible, muted]);

  const isVideo = reel.isVideo && reel.videoUrl;
  const videoMedia = reel.media.filter((m) => m.mimeType.startsWith("video/"));
  const isSilent =
    videoMedia.length > 0 && videoMedia.every((m) => m.hasAudio === false);
  const dateLabel = useMemo(
    () => format(new Date(reel.originalDate), "MMM d, yyyy"),
    [reel.originalDate],
  );
  const caption = reel.body?.trim() ?? "";
  const isLong = caption.length > 140;

  return (
    <section
      ref={ref}
      className="relative flex h-full w-full snap-start snap-always items-center justify-center"
    >
      {isVideo ? (
        <video
          ref={videoRef}
          src={reel.videoUrl!}
          poster={reel.thumbUrl ?? undefined}
          className="h-full w-full object-contain"
          autoPlay
          loop
          playsInline
        />
      ) : reel.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={reel.thumbUrl}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="text-gray-400">No media</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4 text-white">
        <span className="text-sm drop-shadow">{dateLabel}</span>
      </div>

      {isSilent && (
        <div
          className="absolute left-4 top-14 z-10 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white backdrop-blur"
          title="Silent video — no audio track"
        >
          <VolumeX className="h-3.5 w-3.5" />
          <span>Silent</span>
        </div>
      )}

      <Link
        href={`/admin/posts/${reel.id}`}
        className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-white/25"
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Link>

      {caption && (
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-4 pb-8 pt-10 text-white">
          <p
            className={`whitespace-pre-wrap text-[13px] leading-snug drop-shadow ${
              isLong && !expanded ? "line-clamp-2" : ""
            }`}
          >
            {caption}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[12px] font-medium text-white/80 hover:text-white"
            >
              {expanded ? "See less" : "See more"}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
