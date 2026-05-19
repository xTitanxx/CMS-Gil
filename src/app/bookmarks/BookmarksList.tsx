"use client";

import { useMemo, useState, useCallback } from "react";
import { Search, X } from "lucide-react";
import { PostCard, type PostCardData } from "@/components/PostCard";

export interface BookmarkedPost extends PostCardData {
  bookmarkedAt: string;
}

// Forgiving search: lowercase, collapse whitespace, then check that every
// query token is a substring of the haystack. So "trek bike" matches a body
// containing both "Trekinetic" and "biking" even if they're far apart, and
// trailing spaces or weird casing don't kill the match.
function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function buildHaystack(post: PostCardData): string {
  return [post.body ?? "", post.tags.join(" "), post.media.map((m) => m.altText ?? "").join(" ")]
    .join(" ")
    .toLowerCase();
}

function matches(post: PostCardData, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = buildHaystack(post);
  return tokens.every((t) => hay.includes(t));
}

export function BookmarksList({
  initial,
  signedIn,
}: {
  initial: BookmarkedPost[];
  signedIn: boolean;
}) {
  const [posts, setPosts] = useState<BookmarkedPost[]>(initial);
  const [query, setQuery] = useState("");
  const [liked, setLiked] = useState<Set<string>>(new Set());
  // Everything in this list is bookmarked by definition — but unbookmarking
  // a card needs to remove it from the visible list immediately for the UX
  // to feel right.
  const [bookmarked, setBookmarked] = useState<Set<string>>(
    () => new Set(initial.map((p) => p.id)),
  );
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(
    () => new Map(initial.map((p) => [p.id, p.likeCount])),
  );

  const tokens = useMemo(() => tokenize(query), [query]);
  const filtered = useMemo(
    () => posts.filter((p) => matches(p, tokens)),
    [posts, tokens],
  );

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
    [],
  );

  const handleBookmarkChange = useCallback(
    (postId: string, isBookmarked: boolean) => {
      setBookmarked((prev) => {
        const next = new Set(prev);
        if (isBookmarked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      if (!isBookmarked) {
        // Unbookmarking removes the row from this list. The server side
        // already persisted the change via EngagementBar's call.
        setPosts((prev) => prev.filter((p) => p.id !== postId));
      }
    },
    [],
  );

  const handleAuthError = useCallback(() => {
    const next = window.location.pathname + window.location.hash;
    window.location.assign(`/welcome?next=${encodeURIComponent(next)}`);
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your bookmarks"
          aria-label="Search your bookmarks"
          className="w-full rounded-full border border-gray-200 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {posts.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-600 shadow-sm">
          You haven&rsquo;t saved any posts yet. Tap the{" "}
          <span className="font-semibold">Save</span> button on a post to add it
          here.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-600 shadow-sm break-words">
          No bookmarks match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        filtered.map((p) => (
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
        ))
      )}
    </div>
  );
}
