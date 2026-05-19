"use client";

import { useCallback, useState } from "react";
import { PostCard, type PostCardData } from "@/components/PostCard";

// Thin client wrapper around PostCard for the /p/[id] detail page. The
// shared PostCard is controlled (parent owns liked/bookmarked state) so the
// feed and bookmarks pages can coordinate cross-card updates; on the detail
// page there's only one card, so we own its state right here.
export function PostCardClient({
  post,
  initialLiked,
  initialBookmarked,
  signedIn,
}: {
  post: PostCardData;
  initialLiked: boolean;
  initialBookmarked: boolean;
  signedIn: boolean;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [likeCount, setLikeCount] = useState(post.likeCount);

  const handleLikeChange = useCallback((_id: string, l: boolean, c: number) => {
    setLiked(l);
    setLikeCount(c);
  }, []);
  const handleBookmarkChange = useCallback((_id: string, b: boolean) => {
    setBookmarked(b);
  }, []);
  const handleAuthError = useCallback(() => {
    const next = window.location.pathname + window.location.hash;
    window.location.assign(`/welcome?next=${encodeURIComponent(next)}`);
  }, []);

  return (
    <PostCard
      post={post}
      liked={liked}
      bookmarked={bookmarked}
      signedIn={signedIn}
      likeCount={likeCount}
      onLikeChange={handleLikeChange}
      onBookmarkChange={handleBookmarkChange}
      onAuthError={handleAuthError}
      initialExpanded
    />
  );
}
