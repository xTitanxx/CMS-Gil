"use client";

import Link from "next/link";
import { format } from "date-fns";
import { useCallback } from "react";
import {
  Image as ImageIcon,
  Trash2,
  Send,
  Music,
  VolumeX,
  Link as LinkIcon,
  Video,
  Images,
  FileText,
  BarChart3,
  ExternalLink,
} from "lucide-react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { PlatformIcons } from "../scheduled/PlatformIcons";
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
  publishes: { platform: string; status: string; publishedAt: string | null }[];
  analytics: { platform: string; reactions: number | null; comments: number | null; shares: number | null }[];
  rating: { stars: number } | null;
  captionQuality: number | null;
  captionEvergreen: boolean | null;
  captionSuggestion: string | null;
}

const ALL_PLATFORMS = [
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "FACEBOOK_PAGE",
] as const;
const VIDEO_ONLY = new Set(["YOUTUBE", "TIKTOK"]);

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

function RowPublishAllButton({ post }: { post: PostRowData }) {
  const { isLoading, status, message, run } = useAsync();
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  const targets = ALL_PLATFORMS.filter((p) => hasVideo || !VIDEO_ONLY.has(p));

  const handlePublish = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: targets }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Publish failed");
      }
    }, `Publishing to ${targets.length} platform${targets.length === 1 ? "" : "s"}`);
  }, [post.id, targets, run]);
  const { confirming, trigger } = useConfirm(handlePublish);

  const tone =
    status === "error"
      ? "text-red-500"
      : status === "success"
      ? "text-green-600"
      : confirming
      ? "text-amber-500"
      : "text-gray-300 hover:text-blue-600";

  return (
    <button
      className={`flex-shrink-0 self-center p-1 transition-colors ${tone}`}
      onClick={(e) => {
        e.preventDefault();
        trigger();
      }}
      title={
        status === "error"
          ? `Error: ${message}`
          : status === "success"
          ? "Publishing started"
          : confirming
          ? `Publish to ${targets.join(", ")}?`
          : `Publish to all (${targets.length})`
      }
    >
      {isLoading ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
    </button>
  );
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
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm md:items-center md:gap-3 md:p-4 ${
        isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200"
      }`}
    >
      <div className="flex-shrink-0 pt-1 md:pt-0">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => onCheckboxClick(e, post.id, index)}
          onChange={() => {}}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
        />
      </div>

      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4">
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
            <span className="text-xs text-gray-400">
              {format(new Date(post.originalDate), "MMM d, yyyy")}
              <span className="hidden sm:inline"> · {format(new Date(post.originalDate), "h:mm a")}</span>
            </span>
            {post.rating && (
              <span className="text-yellow-500 text-xs" title={`${post.rating.stars}/5`}>
                {"★".repeat(post.rating.stars)}
              </span>
            )}
            {post.captionQuality != null && (
              <span
                className={`text-xs rounded-full px-2 py-0.5 ${
                  post.captionQuality >= 4
                    ? "bg-green-100 text-green-700"
                    : post.captionQuality <= 2
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                }`}
                title={`Caption quality: ${post.captionQuality}/5${post.captionEvergreen === false ? " · non-evergreen caption" : ""}${post.captionSuggestion ? " · AI rewrite available" : ""}`}
              >
                {post.captionQuality >= 4 ? "Good" : post.captionQuality === 3 ? "OK" : "Weak"} caption
                {post.captionEvergreen === false ? " · dated" : ""}
                {post.captionSuggestion ? " · rewrite" : ""}
              </span>
            )}
            {post.platformUrl && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(post.platformUrl!, "_blank", "noopener,noreferrer");
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-blue-600 hover:bg-blue-50"
                title="Open original on Facebook"
                aria-label="Open original on Facebook"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
            {(() => {
              const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
              const count = post.media.length;
              if (count === 0) {
                return (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="hidden sm:inline">Text only</span>
                  </span>
                );
              }
              if (hasVideo) {
                return (
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                    <Video className="h-3 w-3 shrink-0" />
                    Video{count > 1 ? ` +${count - 1}` : ""}
                  </span>
                );
              }
              if (count > 1) {
                return (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                    <Images className="h-3 w-3 shrink-0" />
                    {count} images
                  </span>
                );
              }
              return (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  <ImageIcon className="h-3 w-3 shrink-0" />
                  Image
                </span>
              );
            })()}
            {post.share && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                title={
                  post.share.url
                    ? `Quoted post: ${post.share.url}`
                    : "Quoted a Facebook post (share card not preserved by export)"
                }
              >
                <LinkIcon className="h-3 w-3 shrink-0" />
                <span className="hidden sm:inline">{post.share.url ? "Shared link" : "Quoted FB post"}</span>
              </span>
            )}
            {(() => {
              const fbAnalytics = post.analytics?.find((a) => a.platform === "FACEBOOK");
              if (!fbAnalytics) return null;
              const total = (fbAnalytics.reactions ?? 0) + (fbAnalytics.comments ?? 0) + (fbAnalytics.shares ?? 0);
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                  title={`FB Analytics: ${fbAnalytics.reactions ?? 0} reactions, ${fbAnalytics.comments ?? 0} comments, ${fbAnalytics.shares ?? 0} shares`}
                >
                  <BarChart3 className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">{total > 0 ? total.toLocaleString() : "FB"}</span>
                </span>
              );
            })()}
          </div>
          {displayBody(post.body) ? (
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{displayBody(post.body)}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
          {(() => {
            const visibleTags = post.tags;
            return visibleTags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {visibleTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline-block"
                  >
                    {tag}
                  </span>
                ))}
                {visibleTags.length > 0 && (
                  <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:hidden">
                    {visibleTags.length} tags
                  </span>
                )}
                {visibleTags.length > 3 && (
                  <span className="hidden text-xs text-gray-400 sm:inline">+{visibleTags.length - 3} more</span>
                )}
              </div>
            ) : null;
          })()}
        </div>

        <PlatformIcons
          platforms={[
            ...new Set(
              post.publishes.filter((p) => p.status === "PUBLISHED").map((p) => p.platform),
            ),
          ]}
          size={16}
          className="hidden flex-shrink-0 gap-1.5 md:flex"
        />
      </Link>

      <RowPublishAllButton post={post} />
      <RowDeleteButton postId={post.id} onDeleted={() => onDeleted(post.id)} />
    </div>
  );
}
