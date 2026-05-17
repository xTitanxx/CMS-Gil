"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useCallback } from "react";
import {
  Image as ImageIcon,
  Trash2,
  Music,
  VolumeX,
  Video,
  ExternalLink,
} from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { displayBody } from "@/lib/post-body";

export interface PostRowData {
  id: string;
  body: string;
  source: string;
  postType: string;
  originalDate: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  isVideo: boolean;
  isSilent: boolean;
  audioState: "has-audio" | "silent" | "music-added";
  tags: string[];
  platformUrl: string | null;
  share: { url?: string; source?: string; name?: string } | null;
  media: { id: string; mimeType: string; hasAudio: boolean | null; audioTrackId: string | null }[];
  publishes: { platform: string; status: string; publishedAt: string | null; platformUrl: string | null }[];
  analytics: { platform: string; reactions: number | null; comments: number | null; shares: number | null }[];
  rating: { stars: number } | null;
  captionQuality: number | null;
  captionEvergreen: boolean | null;
  captionSuggestion: string | null;
}

function RowDeleteButton({
  postId,
  onDeleted,
}: {
  postId: string;
  onDeleted: () => void;
}) {
  const { isLoading, run } = useAsync();
  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    onDeleted();
  }, [postId, run, onDeleted]);
  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <div className="flex flex-shrink-0 items-center gap-1.5 self-center">
      {confirming && (
        <span
          aria-live="polite"
          className="text-[11px] font-medium text-amber-600"
        >
          Click again to delete
        </span>
      )}
      <button
        type="button"
        className={`p-1 transition-colors ${
          confirming ? "text-amber-500" : "text-gray-300 hover:text-red-500"
        }`}
        onClick={(e) => {
          e.preventDefault();
          trigger();
        }}
        aria-label={confirming ? "Confirm delete post" : "Delete post"}
        title={confirming ? "Click again to confirm" : "Delete post"}
      >
        {isLoading ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
      </button>
    </div>
  );
}

type PlatformId =
  | "INSTAGRAM"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "FACEBOOK_PAGE"
  | "FACEBOOK";

// Brand-coloured chips for each platform a post was successfully published to.
// Mirrors the palette used in ActivityList so the two views feel like the same
// language at a glance.
//
// Facebook is split: FACEBOOK_PAGE is the API-published Page post (filled blue
// chip) while FACEBOOK is the manual personal-profile post (dashed-outline
// chip). Side-by-side they need to read as obviously different — they share
// the same icon but the chip frame tells the user "this one was hand-posted".
const PLATFORM_CHIP: Record<
  PlatformId,
  { bg: string; fg: string; label: string; border?: string }
> = {
  INSTAGRAM: { bg: "bg-pink-50", fg: "text-pink-600", label: "Instagram" },
  LINKEDIN: { bg: "bg-sky-50", fg: "text-sky-700", label: "LinkedIn" },
  YOUTUBE: { bg: "bg-red-50", fg: "text-red-600", label: "YouTube" },
  TIKTOK: { bg: "bg-gray-100", fg: "text-gray-900", label: "TikTok" },
  FACEBOOK_PAGE: { bg: "bg-blue-50", fg: "text-blue-700", label: "Facebook Page" },
  FACEBOOK: {
    bg: "bg-white",
    fg: "text-blue-700",
    label: "Facebook Personal profile",
    border: "border border-dashed border-blue-400",
  },
};

function platformIcon(platform: PlatformId, className: string) {
  switch (platform) {
    case "INSTAGRAM":
      return <SiInstagram className={className} />;
    case "LINKEDIN":
      return <FaLinkedin className={className} />;
    case "YOUTUBE":
      return <SiYoutube className={className} />;
    case "TIKTOK":
      return <SiTiktok className={className} />;
    case "FACEBOOK_PAGE":
    case "FACEBOOK":
      return <SiFacebook className={className} />;
  }
}

// Dedupes per-platform so a post that was published twice to one platform
// (e.g. retried) only renders one chip.
function publishedPlatforms(
  publishes: PostRowData["publishes"],
): PlatformId[] {
  const seen = new Set<PlatformId>();
  const out: PlatformId[] = [];
  for (const p of publishes) {
    if (p.status !== "PUBLISHED") continue;
    if (!(p.platform in PLATFORM_CHIP)) continue;
    const id = p.platform as PlatformId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export interface PostRowProps {
  post: PostRowData;
  index: number;
  isSelected: boolean;
  href: string;
  onCheckboxClick: (e: React.MouseEvent, postId: string, index: number) => void;
  onDeleted: (postId: string) => void;
}

export function PostRow({ post, index, isSelected, href, onCheckboxClick, onDeleted }: PostRowProps) {
  const published = publishedPlatforms(post.publishes);
  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm ring-1 ring-black/[0.02] transition-all hover:shadow-md md:gap-4 md:p-4 ${
        isSelected
          ? "border-blue-300 bg-blue-50/60 ring-blue-200"
          : "border-gray-100 hover:border-gray-200"
      }`}
    >
      <label className="flex flex-shrink-0 cursor-pointer items-center justify-center self-center">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => onCheckboxClick(e, post.id, index)}
          onChange={() => {}}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
        />
      </label>

      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-28 md:w-28">
          {post.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-6 w-6 text-gray-300" />
            </div>
          )}
          {post.isVideo && (
            <div
              className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5"
              title="Video"
            >
              <Video className="h-3 w-3 text-white" />
            </div>
          )}
          {post.audioState === "silent" && (
            <div
              className="absolute bottom-0.5 right-0.5 rounded-full bg-orange-500/85 p-0.5"
              title="Silent video — no audio track. Attach music before publishing."
            >
              <VolumeX className="h-3 w-3 text-white" />
            </div>
          )}
          {post.audioState === "music-added" && (
            <div
              className="absolute bottom-0.5 right-0.5 rounded-full bg-blue-500/85 p-0.5"
              title="Silent video with custom audio attached — will be muxed at publish time."
            >
              <Music className="h-3 w-3 text-white" />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1 md:gap-2">
            <button
              type="button"
              className="cursor-pointer rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-400 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              title={`#${index + 1} — ID: ${post.id} — click to copy ID`}
              aria-label={`Copy post ID ${post.id}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                navigator.clipboard.writeText(post.id);
              }}
            >
              #{index + 1}
            </button>
            <span
              className="text-sm font-medium text-gray-600"
              title={format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
            >
              {format(new Date(post.originalDate), "MMM d, yyyy")}
            </span>
            {post.platformUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(post.platformUrl!, "_blank", "noopener,noreferrer");
                }}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                title="Open original on Facebook"
                aria-label="Open original on Facebook"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Facebook
              </button>
            )}
          </div>
          {displayBody(post.body) ? (
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{displayBody(post.body)}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
          {published.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {published.map((p) => {
                const c = PLATFORM_CHIP[p];
                return (
                  <span
                    key={p}
                    title={`Published to ${c.label}`}
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full ${c.bg} ${c.border ?? ""}`}
                  >
                    {platformIcon(p, `h-3 w-3 ${c.fg}`)}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </Link>

      <RowDeleteButton postId={post.id} onDeleted={() => onDeleted(post.id)} />
    </div>
  );
}
