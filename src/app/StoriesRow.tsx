// src/app/StoriesRow.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VolumeX } from "lucide-react";
import { StoryViewer } from "./StoryViewer";

interface StoryMedia {
  id: string;
  mimeType: string;
  hasAudio: boolean | null;
  url: string | null;
}

export interface Story {
  id: string;
  originalDate: string;
  media: StoryMedia[];
}

interface StoriesPage {
  stories: Story[];
  nextCursor: { date: string; id: string } | null;
}

export function StoriesRow({ initial }: { initial: StoriesPage }) {
  const [stories, setStories] = useState<Story[]>(initial.stories);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        cursorDate: cursor.date,
        cursorId: cursor.id,
      });
      const res = await fetch(`/api/public/stories?${params}`);
      if (!res.ok) return;
      const data: StoriesPage = await res.json();
      setStories((prev) => [...prev, ...data.stories]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: sentinelRef.current.parentElement, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  if (stories.length === 0) return null;

  return (
    <>
      <div className="mb-4 -mx-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 px-4 pb-2">
          {stories.map((s, i) => (
            <StoryThumbnail
              key={s.id}
              story={s}
              onClick={() => setViewerIndex(i)}
            />
          ))}
          {cursor && (
            <div
              ref={sentinelRef}
              className="flex-shrink-0 w-16 h-16 flex items-center justify-center text-xs text-gray-400"
            >
              {loading ? "..." : ""}
            </div>
          )}
        </div>
      </div>
      {viewerIndex !== null && (
        <StoryViewer
          stories={stories}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onRequestLoadMore={loadMore}
          hasMore={!!cursor}
        />
      )}
    </>
  );
}

function StoryThumbnail({ story, onClick }: { story: Story; onClick: () => void }) {
  const firstMedia = story.media[0];
  if (!firstMedia?.url) return null;

  const isVideo = firstMedia.mimeType.startsWith("video/");
  const isSilent = isVideo && firstMedia.hasAudio === false;

  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0 rounded-full p-[2px] bg-gradient-to-tr from-blue-500 to-purple-500"
    >
      <div className="h-16 w-16 rounded-full overflow-hidden bg-gray-200 border-2 border-white">
        {isVideo ? (
          <video
            src={firstMedia.url}
            className="h-full w-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstMedia.url}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      {isSilent && (
        <div
          className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-black/80 ring-2 ring-white"
          title="Silent video — no audio track"
        >
          <VolumeX className="h-3 w-3 text-white" />
        </div>
      )}
    </button>
  );
}
