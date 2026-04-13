// src/app/StoryViewer.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Story } from "./StoriesRow";

const IMAGE_DURATION_MS = 5000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function StoryViewer({
  stories,
  startIndex,
  onClose,
  onRequestLoadMore,
  hasMore,
}: {
  stories: Story[];
  startIndex: number;
  onClose: () => void;
  onRequestLoadMore?: () => void;
  hasMore?: boolean;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  const story = stories[index];
  const firstMedia = story?.media[0];
  const isVideo = firstMedia?.mimeType.startsWith("video/") ?? false;

  const next = useCallback(() => {
    if (index < stories.length - 1) {
      setIndex((i) => i + 1);
      setProgress(0);
    } else if (hasMore && onRequestLoadMore) {
      // Load more stories; if more arrive, stay on current and let parent update
      onRequestLoadMore();
    } else {
      onClose();
    }
  }, [index, stories.length, hasMore, onRequestLoadMore, onClose]);

  const prev = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setProgress(0);
    }
  }, [index]);

  // Update URL on story change for shareability
  useEffect(() => {
    if (story) {
      window.history.replaceState({}, "", `/s/${story.id}`);
    }
    return () => {
      // When viewer unmounts (close), restore /
      window.history.replaceState({}, "", "/");
    };
  }, [story]);

  // Auto-advance progress for images
  useEffect(() => {
    if (!story || isVideo) return;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / IMAGE_DURATION_MS) * 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        next();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [story, isVideo, next]);

  // Video progress tracking
  const onVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
  }, []);

  // Keyboard controls
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (!story || !firstMedia?.url) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-[3px] bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-none"
              style={{
                width: i < index ? "100%" : i === index ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-20 text-white p-2 hover:bg-white/10 rounded-full"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Date */}
      <div className="absolute top-4 left-4 z-10 text-white text-sm drop-shadow-lg">
        {formatDate(story.originalDate)}
      </div>

      {/* Media */}
      <div className="w-full h-full flex items-center justify-center">
        {isVideo ? (
          <video
            ref={videoRef}
            key={story.id}
            src={firstMedia.url}
            className="max-w-full max-h-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={next}
            onTimeUpdate={onVideoTimeUpdate}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={story.id}
            src={firstMedia.url}
            alt=""
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>

      {/* Tap zones */}
      <button
        onClick={prev}
        className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
        aria-label="Previous story"
      />
      <button
        onClick={next}
        className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
        aria-label="Next story"
      />
    </div>
  );
}
