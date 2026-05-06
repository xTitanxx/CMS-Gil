// src/app/PublicFeed.tsx
"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { MoreHorizontal, BadgeCheck } from "lucide-react";
import { LazyVideo } from "@/components/LazyVideo";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { EngagementBar } from "@/components/EngagementBar";
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
  likeCount: number;
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

function PostCard({
  post,
  liked,
  bookmarked,
  signedIn,
  likeCount,
  onLikeChange,
  onBookmarkChange,
  onAuthError,
}: {
  post: FeedPost;
  liked: boolean;
  bookmarked: boolean;
  signedIn: boolean;
  likeCount: number;
  onLikeChange: (postId: string, liked: boolean, count: number) => void;
  onBookmarkChange: (postId: string, bookmarked: boolean) => void;
  onAuthError: () => void;
}) {
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

      <EngagementBar
        postId={post.id}
        initialLikeCount={likeCount}
        initialLiked={liked}
        initialBookmarked={bookmarked}
        signedIn={signedIn}
        onLikeChange={(l, c) => onLikeChange(post.id, l, c)}
        onBookmarkChange={(b) => onBookmarkChange(post.id, b)}
        onAuthError={onAuthError}
      />
    </article>
  );
}

export function PublicFeed({
  initial,
  signedIn,
}: {
  initial: FeedPage;
  signedIn: boolean;
}) {
  const [posts, setPosts] = useState<FeedPost[]>(initial.posts);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  // Lifted likeCount per post — lets optimistic updates from EngagementBar
  // survive any parent re-render that would otherwise pass stale post.likeCount
  // back into the controlled bar.
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(
    () => new Map(initial.posts.map((p) => [p.id, p.likeCount]))
  );
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleLikeChange = useCallback(
    (postId: string, isLiked: boolean, count: number) => {
      setLiked((prev) => {
        const next = new Set(prev);
        if (isLiked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setLikeCounts((prev) => {
        const next = new Map(prev);
        next.set(postId, count);
        return next;
      });
    },
    []
  );

  const handleBookmarkChange = useCallback(
    (postId: string, isBookmarked: boolean) => {
      setBookmarked((prev) => {
        const next = new Set(prev);
        if (isBookmarked) next.add(postId);
        else next.delete(postId);
        return next;
      });
    },
    []
  );

  const handleAuthError = useCallback(() => {
    const next = window.location.pathname + window.location.hash;
    window.location.assign(`/welcome?next=${encodeURIComponent(next)}`);
  }, []);

  const fetchEngagement = useCallback(
    async (ids: string[]) => {
      if (!signedIn || ids.length === 0) return;
      try {
        const res = await fetch(`/api/me/engagement?postIds=${ids.join(",")}`);
        if (!res.ok) return;
        const data = (await res.json()) as { liked: string[]; bookmarked: string[] };
        setLiked((prev) => {
          const next = new Set(prev);
          for (const id of data.liked) next.add(id);
          return next;
        });
        setBookmarked((prev) => {
          const next = new Set(prev);
          for (const id of data.bookmarked) next.add(id);
          return next;
        });
      } catch {
        // best-effort enrichment, no-op on failure
      }
    },
    [signedIn]
  );

  const initialIds = useMemo(() => initial.posts.map((p) => p.id), [initial.posts]);
  useEffect(() => {
    fetchEngagement(initialIds);
  }, [fetchEngagement, initialIds]);

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
      setLikeCounts((prev) => {
        const next = new Map(prev);
        for (const p of data.posts) {
          if (!next.has(p.id)) next.set(p.id, p.likeCount);
        }
        return next;
      });
      fetchEngagement(data.posts.map((p) => p.id));
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, fetchEngagement]);

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
        <PostCard
          key={p.id}
          post={p}
          liked={liked.has(p.id)}
          bookmarked={bookmarked.has(p.id)}
          signedIn={signedIn}
          likeCount={likeCounts.get(p.id) ?? p.likeCount}
          onLikeChange={handleLikeChange}
          onBookmarkChange={handleBookmarkChange}
          onAuthError={handleAuthError}
        />
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
