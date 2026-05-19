"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { postAudioState } from "@/lib/post-audio-state";
import { posterUrlFor } from "@/components/LazyVideo";

export interface PreviewPost {
  id: string;
  body: string | null;
  originalDate: string;
  tags: string[];
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaAltText: string | null;
  hasAudio: boolean | null;
  /** Surfaced from the public chat API when an AudioTrack is attached. */
  audioTrackId?: string | null;
  /** FB permalink when the post was imported from Facebook. */
  platformUrl?: string | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PostPreviewCard({ post }: { post: PreviewPost }) {
  const body = post.body?.trim() ?? "";
  const truncated = body.length > 150 ? body.slice(0, 150).trimEnd() + "…" : body;
  const isVideo = post.mediaMimeType?.startsWith("video/");
  const [playing, setPlaying] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  // For videos, use the pre-generated .poster.jpg as the still: browsers decode
  // a low-quality preview from preload="metadata" on a bare <video>, which
  // looked visibly pixelated in this card.
  const posterSrc = post.mediaUrl ? posterUrlFor(post.mediaUrl) : null;
  const stillSrc = isVideo && posterSrc && !posterFailed ? posterSrc : post.mediaUrl;

  // Honor the media's natural aspect ratio so portraits don't get cropped to
  // 16:9 and small images don't get upscaled into a wide blurry stripe. When
  // dimensions are missing (legacy rows), fall back to 16:9. `object-contain`
  // + light-gray bg gives a tasteful letterbox in the rare case the container
  // doesn't quite match the media's natural ratio — never black bars.
  const hasNaturalSize = post.mediaWidth && post.mediaHeight && post.mediaWidth > 0 && post.mediaHeight > 0;
  const mediaContainerStyle: React.CSSProperties = hasNaturalSize
    ? { aspectRatio: `${post.mediaWidth} / ${post.mediaHeight}` }
    : {};

  return (
    <article className="my-2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {post.mediaUrl && stillSrc && (
        <div
          className={`relative w-full overflow-hidden bg-gray-100 ${hasNaturalSize ? "max-h-[70vh]" : "aspect-video"}`}
          style={mediaContainerStyle}
        >
          {isVideo && playing ? (
            <video
              src={post.mediaUrl}
              poster={posterSrc ?? undefined}
              controls
              autoPlay
              playsInline
              className="h-full w-full bg-gray-100 object-contain"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={stillSrc}
                alt={post.mediaAltText ?? ""}
                className="h-full w-full object-contain"
                loading="lazy"
                decoding="async"
                onError={isVideo && !posterFailed ? () => setPosterFailed(true) : undefined}
              />
              {isVideo && (
                <>
                  <button
                    type="button"
                    onClick={() => setPlaying(true)}
                    aria-label="Play video"
                    className="absolute inset-0 flex items-center justify-center transition-colors hover:bg-black/10"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 text-white shadow-lg">
                      <Play className="h-6 w-6 fill-current" />
                    </span>
                  </button>
                  <AudioStateBadge
                    state={postAudioState([
                      { mimeType: post.mediaMimeType, hasAudio: post.hasAudio, audioTrackId: post.audioTrackId },
                    ])}
                    className="pointer-events-none absolute left-2 top-2"
                  />
                </>
              )}
            </>
          )}
        </div>
      )}
      <Link href={`/p/${post.id}`} className="block px-3 py-2.5">
        {truncated && (
          <p className="text-sm leading-snug text-gray-800 line-clamp-3">{truncated}</p>
        )}
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-400">{formatDate(post.originalDate)}</p>
          {post.platformUrl && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                window.open(post.platformUrl!, "_blank", "noopener,noreferrer");
              }}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
              title="Open original on Facebook"
              aria-label="Open original on Facebook"
            >
              <ExternalLink className="h-3 w-3" />
              <span>Facebook</span>
            </button>
          )}
        </div>
      </Link>
    </article>
  );
}
