"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Image as ImageIcon, Pencil, VolumeX } from "lucide-react";
import { ViewToggle } from "./ViewToggle";
import { displayBody } from "@/lib/post-body";

interface FeedPost {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  isVideo: boolean;
  isSilent: boolean;
  tags: string[];
  media: { id: string; mimeType: string; hasAudio: boolean | null }[];
  publishes: { platform: string; status: string }[];
}

interface FeedState {
  posts: FeedPost[];
  nextCursor: string | null;
  scrollY: number;
  done: boolean;
}

const feedCache = new Map<string, FeedState>();

const FILTER_KEYS = ["search", "sort", "tags", "audio", "from", "to"] as const;

function buildFilterQuery(sp: URLSearchParams): URLSearchParams {
  const out = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const v = sp.get(key);
    if (v) out.set(key, v);
  }
  return out;
}

export function PostsFeed() {
  const searchParams = useSearchParams();
  const cacheKey = useMemo(() => {
    const qs = buildFilterQuery(new URLSearchParams(searchParams.toString()));
    return qs.toString();
  }, [searchParams]);

  const [posts, setPosts] = useState<FeedPost[]>(
    () => feedCache.get(cacheKey)?.posts ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    () => feedCache.get(cacheKey)?.nextCursor ?? null,
  );
  const [done, setDone] = useState<boolean>(
    () => feedCache.get(cacheKey)?.done ?? false,
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const initialisedRef = useRef(false);

  const detailQueryString = useMemo(() => {
    const qs = buildFilterQuery(new URLSearchParams(searchParams.toString()));
    qs.set("view", "feed");
    return qs.toString();
  }, [searchParams]);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setLoading(true);
      setErrorMessage(null);
      try {
        const qs = buildFilterQuery(new URLSearchParams(searchParams.toString()));
        qs.set("limit", "20");
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/posts?${qs.toString()}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = (await res.json()) as {
          posts: FeedPost[];
          nextCursor: string | null;
        };
        setPosts((prev) => (cursor ? [...prev, ...data.posts] : data.posts));
        setNextCursor(data.nextCursor);
        setDone(data.nextCursor === null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load feed");
      } finally {
        setLoading(false);
        isLoadingRef.current = false;
      }
    },
    [searchParams],
  );

  useEffect(() => {
    if (initialisedRef.current) return;
    initialisedRef.current = true;

    const cached = feedCache.get(cacheKey);
    if (cached && cached.posts.length > 0) {
      if (cached.scrollY) {
        requestAnimationFrame(() => window.scrollTo(0, cached.scrollY));
      }
      return;
    }
    fetchPage(null);
  }, [cacheKey, fetchPage]);

  useEffect(() => {
    feedCache.set(cacheKey, {
      posts,
      nextCursor,
      scrollY: 0,
      done,
    });
  }, [cacheKey, posts, nextCursor, done]);

  useEffect(() => {
    const saveScroll = () => {
      const existing = feedCache.get(cacheKey);
      if (existing) {
        feedCache.set(cacheKey, { ...existing, scrollY: window.scrollY });
      }
    };
    window.addEventListener("pagehide", saveScroll);
    return () => {
      saveScroll();
      window.removeEventListener("pagehide", saveScroll);
    };
  }, [cacheKey]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && nextCursor && !isLoadingRef.current) {
            fetchPage(nextCursor);
          }
        }
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, fetchPage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Posts</h1>
          <p className="text-sm text-gray-500">
            {posts.length > 0 ? `Showing ${posts.length}` : "Feed view"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Link href="/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl space-y-6">
        {posts.map((post) => (
          <FeedCard
            key={post.id}
            post={post}
            href={`/posts/${post.id}?${detailQueryString}`}
          />
        ))}

        {loading && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
              <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="h-4 w-4/5 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-3/5 animate-pulse rounded bg-gray-200" />
            <div className="mt-4 h-52 animate-pulse rounded-xl bg-gray-200" />
          </div>
        )}

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}{" "}
            <button
              className="font-medium underline hover:text-red-900"
              onClick={() => fetchPage(nextCursor)}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && posts.length === 0 && !errorMessage && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
            <p className="text-gray-500">No posts found.</p>
            <Link
              href="/import"
              className="mt-2 block text-sm text-blue-600 hover:underline"
            >
              Import posts
            </Link>
          </div>
        )}

        {done && posts.length > 0 && (
          <p className="py-6 text-center text-sm text-gray-400">
            End of feed — {posts.length} posts
          </p>
        )}

        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      </div>
    </div>
  );
}

function FeedCard({ post, href }: { post: FeedPost; href: string }) {
  const firstMedia = post.media[0];
  const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;

  return (
    <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-3 border-b border-gray-50 px-5 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-gray-500">
            {format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
          </span>
          <Badge variant="outline" className="text-xs">
            {post.source}
          </Badge>
          {post.isSilent && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
              title="Silent video"
            >
              <VolumeX className="h-3 w-3" /> Silent
            </span>
          )}
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Link>
      </header>

      {displayBody(post.body) && (
        <div className="whitespace-pre-wrap px-5 py-4 text-[15px] leading-relaxed text-gray-800">
          {displayBody(post.body)}
        </div>
      )}

      {post.thumbUrl && (
        <Link href={href} className="block bg-gray-50">
          <div className="relative w-full">
            {isVideo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.thumbUrl}
                alt=""
                className="w-full object-contain max-h-[70vh]"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.thumbUrl}
                alt=""
                className="w-full object-contain max-h-[70vh]"
              />
            )}
            {isVideo && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-full bg-black/50 p-4">
                  <svg
                    className="h-8 w-8 fill-white text-white"
                    viewBox="0 0 24 24"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
              </div>
            )}
          </div>
        </Link>
      )}

      {!post.thumbUrl && post.media.length === 0 && !displayBody(post.body) && (
        <div className="flex items-center justify-center px-5 py-10 text-gray-300">
          <ImageIcon className="h-8 w-8" />
        </div>
      )}

      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 px-5 py-3">
          {post.tags.map((tag) => (
            <span
              key={tag}
              className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {post.publishes.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-gray-50 px-5 py-3">
          {post.publishes.map((p) => (
            <Badge
              key={p.platform}
              variant={
                p.status === "PUBLISHED"
                  ? "success"
                  : p.status === "FAILED"
                  ? "destructive"
                  : "secondary"
              }
              className="text-xs"
            >
              {p.platform}
            </Badge>
          ))}
        </div>
      )}
    </article>
  );
}
