"use client";

import { useState } from "react";
import { MoreHorizontal, BadgeCheck } from "lucide-react";
import { LazyVideo } from "@/components/LazyVideo";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { EngagementBar } from "@/components/EngagementBar";
import { postAudioState } from "@/lib/post-audio-state";

export interface PostCardMedia {
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

export interface PostCardData {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  likeCount: number;
  media: PostCardMedia[];
}

const CAPTION_CHAR_LIMIT = 220;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PostCard({
  post,
  liked,
  bookmarked,
  signedIn,
  likeCount,
  onLikeChange,
  onBookmarkChange,
  onAuthError,
}: {
  post: PostCardData;
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

  const handleSeeMore = () => {
    // Lock scroll position before expansion so the card growing taller doesn't
    // let the browser's scroll-anchor heuristic jump the viewport.
    const y = window.scrollY;
    setExpanded(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.scrollTo(0, y);
      });
    });
  };

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
                  onClick={handleSeeMore}
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
                  naturalWidth={m.width ?? undefined}
                  naturalHeight={m.height ?? undefined}
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
                loading="lazy"
                decoding="async"
                width={m.width ?? undefined}
                height={m.height ?? undefined}
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
