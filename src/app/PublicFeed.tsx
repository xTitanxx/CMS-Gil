// src/app/PublicFeed.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

interface Media {
  id: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
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

function PostCard({ post }: { post: FeedPost }) {
  return (
    <Link
      href={`/p/${post.id}`}
      className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
    >
      <p className="text-xs text-gray-500 mb-2">{formatDate(post.originalDate)}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap mb-3">{post.body}</p>
      {post.media.length > 0 && (
        <div className="flex flex-col gap-2">
          {post.media.map((m) =>
            m.url && m.mimeType.startsWith("video/") ? (
              <video
                key={m.id}
                src={m.url}
                controls
                className="rounded max-w-full"
                preload="metadata"
              />
            ) : m.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={m.url}
                alt={m.altText ?? ""}
                className="rounded max-w-full h-auto"
              />
            ) : null
          )}
        </div>
      )}
    </Link>
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
