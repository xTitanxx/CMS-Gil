// src/app/StoriesRow.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  thumbUrl?: string | null;
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

  // Use thumbUrl for the circular thumbnail — works on mobile where <video> doesn't preload
  const thumbSrc = story.thumbUrl ?? firstMedia.url;

  return (
    <button
      onClick={onClick}
      className="relative flex-shrink-0 rounded-full p-[2px] bg-gradient-to-tr from-blue-500 to-purple-500"
    >
      <div className="h-16 w-16 rounded-full overflow-hidden bg-gray-200 border-2 border-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbSrc}
          alt=""
          className="h-full w-full object-cover"
        />
      </div>
    </button>
  );
}
