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
import { displayBody } from "@/lib/post-body";
import type { PostRowData } from "@/app/admin/posts/PostRow";

interface Props {
  post: PostRowData;
  index: number;
  href: string;
}

interface PublishEvent {
  platform: string;
  at: Date;
}

// Within this gap we treat platform publishes as "the same event".
// Hub publishNow() loops platforms sequentially and typically lands them
// inside a few seconds; anything wider than this is a meaningful re-post.
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

export function PublishedPostRow({ post, index, href }: Props) {
  const events = collectPublishEvents(post);
  const platforms = [...new Set(events.map((e) => e.platform))];
  const body = displayBody(post.body);

  return (
    <div className="flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-shadow hover:shadow-sm md:items-center md:gap-4 md:p-4">
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4"
      >
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
        </div>

        <div className="min-w-0 flex-1">
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
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{body}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
        </div>

        <PlatformIcons
          platforms={platforms}
          size={18}
          className="hidden flex-shrink-0 gap-2 md:flex"
        />
      </Link>
    </div>
  );
}
