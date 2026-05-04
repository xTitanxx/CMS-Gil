"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, Volume2, VolumeX } from "lucide-react";
import { ViewToggle } from "./ViewToggle";
import { KindTabs } from "./KindTabs";
import { SubKindTabs, type SubKindCounts } from "./SubKindTabs";
import { posterUrlFor } from "@/components/LazyVideo";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { postAudioState } from "@/lib/post-audio-state";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";

interface ReelStory {
  id: string;
  originalDate: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  isVideo: boolean;
  media: { id: string; mimeType: string; hasAudio: boolean | null; audioTrackId: string | null }[];
}

export function StoriesReel() {
  const searchParams = useSearchParams();
  const subKind = searchParams.get("subKind") ?? "all";
  const [stories, setStories] = useState<ReelStory[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(true);
  const [subKindCounts, setSubKindCounts] = useState<SubKindCounts | null>(null);
  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const fetchPage = useCallback(
    async (cursor: string | null, sub: string) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setLoading(true);
      try {
        const qs = new URLSearchParams({ kind: "stories", limit: "15" });
        if (sub !== "all") qs.set("subKind", sub);
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/posts?${qs.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          posts: ReelStory[];
          nextCursor: string | null;
        };
        setStories((prev) => (cursor ? [...prev, ...data.posts] : data.posts));
        setNextCursor(data.nextCursor);
      } finally {
        setLoading(false);
        isLoadingRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    setStories([]);
    setNextCursor(null);
    fetchPage(null, subKind);
  }, [fetchPage, subKind]);

  const handleDeleted = useCallback((storyId: string) => {
    setStories((prev) => prev.filter((s) => s.id !== storyId));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const qs = new URLSearchParams({ kind: "stories", limit: "1", page: "1" });
      const res = await fetch(`/api/posts?${qs.toString()}`);
      if (!res.ok) return;
      const data = (await res.json()) as { subKindCounts?: SubKindCounts };
      if (cancelled) return;
      if (data.subKindCounts) setSubKindCounts(data.subKindCounts);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !isLoadingRef.current) {
            fetchPage(nextCursor, subKind);
          }
        }
      },
      { root: el.parentElement, rootMargin: "600px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, fetchPage, subKind]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="hidden text-2xl font-bold text-gray-900 md:block">All Stories</h1>
          <p className="text-sm text-gray-500">
            {stories.length > 0 ? `${stories.length} loaded` : "Stories"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Link href="/admin/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Post</span>
            </Button>
          </Link>
        </div>
      </div>

      <KindTabs current="stories" />
      <SubKindTabs kind="stories" current={subKind} counts={subKindCounts} />

      {loading && stories.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl bg-black/5">
          <p className="text-sm text-gray-500">Loading stories…</p>
        </div>
      ) : stories.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-xl border-2 border-dashed border-gray-200">
          <p className="text-gray-500">No stories found.</p>
        </div>
      ) : (
        <div
          className="relative flex-1 snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-xl bg-black"
          style={{ scrollSnapStop: "always" }}
        >
          {stories.map((s) => (
            <ReelSlide key={s.id} story={s} muted={muted} onDeleted={handleDeleted} />
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

function ReelDeleteButton({
  storyId,
  onDeleted,
}: {
  storyId: string;
  onDeleted: (storyId: string) => void;
}) {
  const { isLoading, run } = useAsync();
  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${storyId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    onDeleted(storyId);
  }, [storyId, run, onDeleted]);
  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        trigger();
      }}
      aria-label={confirming ? "Confirm delete story" : "Delete story"}
      title={confirming ? "Click again to confirm" : "Delete story"}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs backdrop-blur transition-colors ${
        confirming
          ? "bg-amber-500/80 text-white hover:bg-amber-500/90"
          : "bg-white/15 text-white hover:bg-white/25"
      }`}
    >
      {isLoading ? <Spinner className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
      {confirming ? "Confirm" : "Delete"}
    </button>
  );
}

function ReelSlide({
  story,
  muted,
  onDeleted,
}: {
  story: ReelStory;
  muted: boolean;
  onDeleted: (storyId: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.parentElement;

    const visibleIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.intersectionRatio > 0.6);
      },
      { root, threshold: [0, 0.6, 1] },
    );

    const mountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setMounted(true);
        }
      },
      { root, rootMargin: "100% 0px" },
    );
    const unmountIO = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) setMounted(false);
        }
      },
      { root, rootMargin: "150% 0px" },
    );

    visibleIO.observe(el);
    mountIO.observe(el);
    unmountIO.observe(el);
    return () => {
      visibleIO.disconnect();
      mountIO.disconnect();
      unmountIO.disconnect();
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    if (visible) {
      v.currentTime = 0;
      v.play().catch(() => {
        // Autoplay with sound may be blocked; fall back to muted playback.
        if (!v.muted) {
          v.muted = true;
          v.play().catch(() => {});
        }
      });
    } else {
      v.pause();
    }
  }, [visible, muted, mounted]);

  const isVideo = story.isVideo && story.videoUrl;
  const audioState = postAudioState(story.media);
  const dateLabel = useMemo(
    () => format(new Date(story.originalDate), "MMM d, yyyy"),
    [story.originalDate],
  );

  return (
    <section
      ref={ref}
      className="relative flex h-full w-full snap-start snap-always items-center justify-center"
    >
      {isVideo ? (
        mounted ? (
          <video
            ref={videoRef}
            src={story.videoUrl!}
            poster={story.thumbUrl ?? posterUrlFor(story.videoUrl!)}
            className="h-full w-full object-contain"
            autoPlay
            loop
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={story.thumbUrl ?? posterUrlFor(story.videoUrl!)}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-contain"
          />
        )
      ) : story.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={story.thumbUrl}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : (
        <div className="text-gray-400">No media</div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4 text-white">
        <span className="text-sm drop-shadow">{dateLabel}</span>
      </div>

      <AudioStateBadge state={audioState} className="absolute left-4 top-14 z-10" />

      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <Link
          href={`/admin/posts/${story.id}`}
          className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs text-white backdrop-blur hover:bg-white/25"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
        <ReelDeleteButton storyId={story.id} onDeleted={onDeleted} />
      </div>
    </section>
  );
}
