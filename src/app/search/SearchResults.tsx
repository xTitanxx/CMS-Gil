"use client";

import { useState, useMemo, useCallback } from "react";
import { PostCard } from "@/components/PostCard";
import type { PublicSearchHit } from "@/lib/retrieval/public-search";

export function SearchResults({
  hits,
  isSearch,
  signedIn,
}: {
  hits: PublicSearchHit[];
  isSearch: boolean;
  signedIn: boolean;
}) {
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [bookmarked, setBookmarked] = useState<Set<string>>(new Set());
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(
    () => new Map(hits.map((h) => [h.id, h.likeCount])),
  );
  const [sort, setSort] = useState<"relevance" | "date">(
    isSearch ? "relevance" : "date",
  );

  const sorted = useMemo(() => {
    if (sort === "date") {
      return [...hits].sort(
        (a, b) =>
          new Date(b.originalDate).getTime() -
          new Date(a.originalDate).getTime(),
      );
    }
    return hits;
  }, [hits, sort]);

  const handleLikeChange = useCallback(
    (postId: string, isLiked: boolean, count: number) => {
      setLiked((prev) => {
        const next = new Set(prev);
        if (isLiked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setLikeCounts((prev) => new Map(prev).set(postId, count));
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
    },
    [],
  );

  const handleAuthError = useCallback(() => {
    const next = window.location.pathname + window.location.search;
    window.location.assign(`/welcome?next=${encodeURIComponent(next)}`);
  }, []);

  return (
    <div>
      {hits.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500">Sort:</span>
          {isSearch && (
            <button
              type="button"
              onClick={() => setSort("relevance")}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                sort === "relevance"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              Relevance
            </button>
          )}
          <button
            type="button"
            onClick={() => setSort("date")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sort === "date"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            Date
          </button>
        </div>
      )}
      <div className="flex flex-col gap-3">
        {sorted.map((hit) => (
          <PostCard
            key={hit.id}
            post={hit}
            href={`/p/${hit.id}`}
            liked={liked.has(hit.id)}
            bookmarked={bookmarked.has(hit.id)}
            signedIn={signedIn}
            likeCount={likeCounts.get(hit.id) ?? hit.likeCount}
            onLikeChange={handleLikeChange}
            onBookmarkChange={handleBookmarkChange}
            onAuthError={handleAuthError}
          />
        ))}
      </div>
    </div>
  );
}
