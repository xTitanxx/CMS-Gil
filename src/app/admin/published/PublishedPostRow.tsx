"use client";

import Link from "next/link";
import { useState } from "react";
import { format } from "date-fns";
import {
  Image as ImageIcon,
  Music,
  VolumeX,
  Video,
  Images,
  FileText,
  ChevronDown,
} from "lucide-react";
import { PlatformIcons } from "@/app/admin/scheduled/PlatformIcons";
import {
  PlatformBadgeRow,
  PLATFORM_ORDER,
  isEligible,
  type PlatformBadgeState,
  type PostedPill,
  type PostKind,
} from "@/app/admin/_shared/PlatformBadgeRow";
import { displayBody } from "@/lib/post-body";
import type { PostRowData } from "@/app/admin/posts/PostRow";

function postKind(post: PostRowData): PostKind {
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  if (hasVideo) return "video";
  if (post.media.length > 0) return "image";
  return "text";
}

function postedPillFor(post: PostRowData, platform: string): PostedPill | null {
  // Prefer the most recent PublishRecord that actually has a permalink so the
  // badge can become a link, falling back to a record without a URL if that's
  // all there is.
  let best: PostedPill | null = null;
  for (const p of post.publishes) {
    if (p.platform !== platform || p.status !== "PUBLISHED") continue;
    if (!best || (!best.platformUrl && p.platformUrl)) {
      best = { platform: p.platform, platformUrl: p.platformUrl };
    }
  }
  return best;
}

interface Props {
  post: PostRowData;
  index: number;
  href: string;
  fbPending: boolean;
}

interface PublishEvent {
  platform: string;
  at: Date;
}

// Within this gap we treat platform publishes as "the same event".
const SIMULTANEOUS_THRESHOLD_MS = 60_000;

function collectPublishEvents(post: PostRowData): PublishEvent[] {
  return post.publishes
    .filter((p) => p.status === "PUBLISHED" && p.publishedAt)
    .map((p) => ({ platform: p.platform, at: new Date(p.publishedAt as string) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

function PostTypeBadge({ post }: { post: PostRowData }) {
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  const count = post.media.length;
  const base =
    "inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500";
  if (count === 0) {
    return (
      <span className={base}>
        <FileText className="h-3 w-3 shrink-0" />
        <span className="hidden sm:inline">Text</span>
      </span>
    );
  }
  if (hasVideo) {
    return (
      <span className={base}>
        <Video className="h-3 w-3 shrink-0" />
        Video{count > 1 ? ` +${count - 1}` : ""}
      </span>
    );
  }
  if (count > 1) {
    return (
      <span className={base}>
        <Images className="h-3 w-3 shrink-0" />
        {count} images
      </span>
    );
  }
  return (
    <span className={base}>
      <ImageIcon className="h-3 w-3 shrink-0" />
      Image
    </span>
  );
}

function PublishTimeBlock({ events }: { events: PublishEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;

  const first = events[0].at;
  const last = events[events.length - 1].at;
  const spread = last.getTime() - first.getTime();
  const simultaneous = events.length === 1 || spread <= SIMULTANEOUS_THRESHOLD_MS;

  if (simultaneous) {
    return (
      <span className="text-xs text-gray-500">
        Posted {format(first, "MMM d, yyyy · h:mm a")}
        {events.length > 1 && (
          <span className="ml-1 text-gray-400">(simultaneous)</span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex items-center gap-1 rounded text-xs text-gray-500 hover:text-gray-700"
        aria-expanded={open}
        title="Posts went out at different times — click to see each platform"
      >
        Posted {format(first, "MMM d, yyyy · h:mm a")}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul className="mt-0.5 space-y-0.5 text-[11px] text-gray-500">
          {events.map((ev) => (
            <li key={ev.platform} className="flex items-center gap-1.5">
              <PlatformIcons platforms={[ev.platform]} size={11} />
              <span className="tabular-nums">
                {format(ev.at, "MMM d, yyyy · h:mm:ss a")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

export function PublishedPostRow({ post, index, href, fbPending }: Props) {
  const events = collectPublishEvents(post);
  const body = displayBody(post.body);
  const kind = postKind(post);

  // Local optimistic state: when the user clicks "Unmark" on the FB Personal
  // pill, drop it from the list right away. The post stays in the Published
  // tab as long as some other platform is still PUBLISHED (the server uses
  // hubPublishCount > 0, not a single-platform flag).
  const [fbUnmarked, setFbUnmarked] = useState(false);

  // Resolve the badge state for each platform from publish records + the
  // manual-FB queue. Anything not resolved here falls back to "skipped" or
  // "na" inside PlatformBadgeRow based on `isEligible(platform, kind)`.
  const stateByPlatform: Partial<Record<string, PlatformBadgeState>> = {};
  const pillByPlatform: Partial<Record<string, PostedPill | null>> = {};
  for (const platform of PLATFORM_ORDER) {
    const pill =
      platform === "FACEBOOK" && fbUnmarked ? null : postedPillFor(post, platform);
    pillByPlatform[platform] = pill;
    if (pill) {
      stateByPlatform[platform] = "posted";
    } else if (platform === "FACEBOOK" && fbPending && !fbUnmarked) {
      // FB Personal didn't fire automatically — and the slot is past, so the
      // cross-post is overdue rather than merely "pending in the future."
      stateByPlatform[platform] = "overdue";
    } else if (isEligible(platform, kind)) {
      stateByPlatform[platform] = "skipped";
    } else {
      stateByPlatform[platform] = "na";
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:shadow-sm md:items-center md:gap-4 md:p-4">
      <Link
        href={href}
        className="relative block h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-28 md:w-28"
      >
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
            title="Silent video — no audio track."
          >
            <VolumeX className="h-3 w-3 text-white" />
          </div>
        )}
        {post.audioState === "music-added" && (
          <div
            className="absolute bottom-0.5 right-0.5 rounded-full bg-blue-500/85 p-0.5"
            title="Silent video with custom audio attached."
          >
            <Music className="h-3 w-3 text-white" />
          </div>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={href} className="block">
          <div className="flex flex-wrap items-center gap-1 md:gap-2">
            <span
              className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-400"
              title={`#${index + 1} — ID: ${post.id}`}
            >
              #{index + 1}
            </span>
            <PostTypeBadge post={post} />
            <PublishTimeBlock events={events} />
          </div>
          {body ? (
            <p className="mt-1 line-clamp-2 break-words text-sm text-gray-700">{body}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
        </Link>
        <div className="mt-1.5">
          <PlatformBadgeRow
            postId={post.id}
            kind={kind}
            stateByPlatform={stateByPlatform}
            pillByPlatform={pillByPlatform}
            onUnmarkedFb={() => setFbUnmarked(true)}
          />
        </div>
      </div>
    </div>
  );
}
