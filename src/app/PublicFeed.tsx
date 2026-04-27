// src/app/PublicFeed.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { ThumbsUp, MessageCircle, Share2, MoreHorizontal, BadgeCheck } from "lucide-react";
import { LazyVideo } from "@/components/LazyVideo";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { postAudioState } from "@/lib/post-audio-state";

interface Media {
  id: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  hasAudio: boolean | null;
  /** Optional — only populated by /api/public/feed (and /api/public/stories), not the SSR initial fetch. */
  audioTrackId?: string | null;
  url: string | null;
}

interface FeedPost {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
}

interface FeedPage {
  posts: FeedPost[];
  nextCursor: { date: string; id: string } | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const CAPTION_CHAR_LIMIT = 220;

function PostCard({ post }: { post: FeedPost }) {
  const [expanded, setExpanded] = useState(false);
  const body = post.body ?? "";
  const isLong = body.length > CAPTION_CHAR_LIMIT;
  const shown = !expanded && isLong ? body.slice(0, CAPTION_CHAR_LIMIT).trimEnd() + "…" : body;

  return (
    <article className="overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" />
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1">
            <span className="text-[15px] font-semibold text-gray-900">Gil Alter</span>
            <BadgeCheck className="h-4 w-4 fill-blue-600 text-white" />
          </div>
          <p className="text-xs text-gray-500">{formatDate(post.originalDate)}</p>
        </div>
        <button
          type="button"
          className="rounded-full p-1.5 text-gray-500 hover:bg-gray-100"
          aria-label="More"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {/* Caption */}
      {body && (
        <div className="px-3 pb-2">
          <p className="whitespace-pre-wrap text-[15px] leading-[1.35] text-gray-900">
            {shown}
            {isLong && !expanded && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="font-semibold text-gray-600 hover:underline"
                >
                  See more
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {/* Media — edge to edge */}
      {post.media.length > 0 && (
        <div className="flex flex-col">
          {post.media.map((m) =>
            m.url && m.mimeType.startsWith("video/") ? (
              <div key={m.id} className="relative">
                <LazyVideo
                  src={m.url}
                  controls
                  preload="metadata"
                  playsInline
                  wrapperClassName="w-full bg-black"
                  className="w-full"
                />
                <AudioStateBadge
                  state={postAudioState([m])}
                  className="pointer-events-none absolute left-2 top-2"
                />
              </div>
            ) : m.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={m.url}
                alt={m.altText ?? ""}
                className="h-auto w-full"
              />
            ) : null,
          )}
        </div>
      )}

      {/* Reaction summary row */}
      <div className="flex items-center justify-between px-3 py-2 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <span className="flex -space-x-1">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white ring-2 ring-white">
              👍
            </span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] text-white ring-2 ring-white">
              ❤
            </span>
          </span>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-around border-t border-gray-200 px-1 py-0.5 text-sm font-medium text-gray-600">
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100"
        >
          <ThumbsUp className="h-5 w-5" />
          <span>Like</span>
        </button>
        <Link
          href={`/p/${post.id}`}
          className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100"
        >
          <MessageCircle className="h-5 w-5" />
          <span>Comment</span>
        </Link>
        <button
          type="button"
          className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100"
        >
          <Share2 className="h-5 w-5" />
          <span>Share</span>
        </button>
      </div>
    </article>
  );
}

export function PublicFeed({ initial }: { initial: FeedPage }) {
  const [posts, setPosts] = useState<FeedPost[]>(initial.posts);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        cursorDate: cursor.date,
        cursorId: cursor.id,
      });
      const res = await fetch(`/api/public/feed?${params}`);
      if (!res.ok) return;
      const data: FeedPage = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  return (
    <div className="flex flex-col gap-3">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {cursor && (
        <div ref={sentinelRef} className="py-8 text-center text-xs text-gray-400">
          {loading ? "Loading..." : " "}
        </div>
      )}
      {!cursor && posts.length > 0 && (
        <p className="py-8 text-center text-xs text-gray-400">That's the beginning.</p>
      )}
      {posts.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">No posts yet.</p>
      )}
    </div>
  );
}
