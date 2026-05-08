"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { AudioStateBadge } from "@/components/AudioStateBadge";
import { postAudioState } from "@/lib/post-audio-state";

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
  const truncated = body.length > 150 ? body.slice(0, 150).trimEnd() + "\u2026" : body;
  const isVideo = post.mediaMimeType?.startsWith("video/");

  return (
    <Link
      href={`/p/${post.id}`}
      className="my-2 block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      {post.mediaUrl && (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
          {isVideo ? (
            <>
              <video
                src={post.mediaUrl}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
              <AudioStateBadge
                state={postAudioState([
                  { mimeType: post.mediaMimeType, hasAudio: post.hasAudio, audioTrackId: post.audioTrackId },
                ])}
                className="absolute left-2 top-2"
              />
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.mediaUrl}
              alt={post.mediaAltText ?? ""}
              className="h-full w-full object-cover"
            />
          )}
        </div>
      )}
      <div className="px-3 py-2.5">
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
      </div>
    </Link>
  );
}
