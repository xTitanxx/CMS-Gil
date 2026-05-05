"use client";

import { useState } from "react";
import Link from "next/link";
import { Heart, MessageCircle, Bookmark } from "lucide-react";
import { ShareButton } from "./ShareButton";

interface Props {
  postId: string;
  initialLikeCount: number;
  initialLiked: boolean;
  initialBookmarked: boolean;
  /** Path to the comment-section anchor on /p/[id]. Defaults to none — Comment button just links to /p/[id]. */
  commentHref?: string;
  /** When true, this is on the post detail page where comments are inline; the Comment button scrolls instead of navigates. */
  commentScrollTarget?: string;
  /** True when the viewer has no subscriber session — clicks on Like/Bookmark route to /welcome. */
  signedIn: boolean;
}

const SIGN_IN_URL = (next: string) =>
  `/welcome?next=${encodeURIComponent(next)}`;

export function EngagementBar({
  postId,
  initialLikeCount,
  initialLiked,
  initialBookmarked,
  commentHref,
  commentScrollTarget,
  signedIn,
}: Props) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialLikeCount);
  const [bookmarked, setBookmarked] = useState(initialBookmarked);
  const [busyLike, setBusyLike] = useState(false);
  const [busyBookmark, setBusyBookmark] = useState(false);

  async function handleLike() {
    if (!signedIn) {
      window.location.assign(SIGN_IN_URL(`/p/${postId}#engagement`));
      return;
    }
    if (busyLike) return;
    setBusyLike(true);
    const prevLiked = liked;
    const prevCount = count;
    setLiked(!prevLiked);
    setCount(prevLiked ? Math.max(0, prevCount - 1) : prevCount + 1);
    try {
      const res = await fetch(`/api/posts/${postId}/like`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { liked: boolean; count: number };
      setLiked(data.liked);
      setCount(data.count);
    } catch {
      setLiked(prevLiked);
      setCount(prevCount);
    } finally {
      setBusyLike(false);
    }
  }

  async function handleBookmark() {
    if (!signedIn) {
      window.location.assign(SIGN_IN_URL(`/p/${postId}#engagement`));
      return;
    }
    if (busyBookmark) return;
    setBusyBookmark(true);
    const prev = bookmarked;
    setBookmarked(!prev);
    try {
      const res = await fetch(`/api/posts/${postId}/bookmark`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { bookmarked: boolean };
      setBookmarked(data.bookmarked);
    } catch {
      setBookmarked(prev);
    } finally {
      setBusyBookmark(false);
    }
  }

  function handleCommentJump(e: React.MouseEvent) {
    if (!commentScrollTarget) return;
    e.preventDefault();
    const el = document.querySelector(commentScrollTarget);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const commentTarget = commentHref ?? `/p/${postId}#comments`;

  return (
    <div
      id="engagement"
      className="flex items-center justify-around border-t border-gray-200 px-1 py-0.5 text-sm font-medium text-gray-600"
    >
      <button
        type="button"
        onClick={handleLike}
        disabled={busyLike}
        aria-pressed={liked}
        aria-label={liked ? "Unlike" : "Like"}
        className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100 disabled:opacity-60 ${
          liked ? "text-red-600" : ""
        }`}
      >
        <Heart className={`h-5 w-5 ${liked ? "fill-red-600" : ""}`} />
        {/* Hide "0" — show count only when > 0 */}
        <span>{count > 0 ? count : "Like"}</span>
      </button>

      <Link
        href={commentTarget}
        onClick={handleCommentJump}
        className="flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100"
      >
        <MessageCircle className="h-5 w-5" />
        <span>Comment</span>
      </Link>

      <button
        type="button"
        onClick={handleBookmark}
        disabled={busyBookmark}
        aria-pressed={bookmarked}
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
        className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 hover:bg-gray-100 disabled:opacity-60 ${
          bookmarked ? "text-blue-600" : ""
        }`}
      >
        <Bookmark className={`h-5 w-5 ${bookmarked ? "fill-blue-600" : ""}`} />
        <span>Save</span>
      </button>

      <ShareButton url={`/p/${postId}`} title="Gil Alter" />
    </div>
  );
}
