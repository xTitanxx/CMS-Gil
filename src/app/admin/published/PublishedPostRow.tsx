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
  ExternalLink,
  Hand,
  Loader2,
  Undo2,
} from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { PlatformIcons } from "@/app/admin/scheduled/PlatformIcons";
import { displayBody } from "@/lib/post-body";
import type { PostRowData } from "@/app/admin/posts/PostRow";

type PlatformIconComponent = React.ComponentType<{ className?: string }>;

const PLATFORM_META: Record<
  string,
  { label: string; icon: PlatformIconComponent; iconColor: string; manual?: boolean }
> = {
  // FACEBOOK = personal profile. The hub has no API path to a personal
  // profile, so every PublishRecord with platform=FACEBOOK was recorded
  // after the user manually pasted into Facebook themselves.
  FACEBOOK: {
    label: "FB Personal",
    icon: SiFacebook as PlatformIconComponent,
    iconColor: "text-[#1877F2]",
    manual: true,
  },
  FACEBOOK_PAGE: {
    label: "FB Page",
    icon: SiFacebook as PlatformIconComponent,
    iconColor: "text-[#1877F2]",
  },
  INSTAGRAM: {
    label: "Instagram",
    icon: SiInstagram as PlatformIconComponent,
    iconColor: "text-pink-600",
  },
  LINKEDIN: {
    label: "LinkedIn",
    icon: FaLinkedin as PlatformIconComponent,
    iconColor: "text-blue-700",
  },
  YOUTUBE: {
    label: "YouTube",
    icon: SiYoutube as PlatformIconComponent,
    iconColor: "text-red-600",
  },
  TIKTOK: {
    label: "TikTok",
    icon: SiTiktok as PlatformIconComponent,
    iconColor: "text-gray-900",
  },
};

// Canonical render order. We always render the same 6 slots per row so the
// user sees a consistent grid and an absent badge is impossible — an
// "ineligible" or "skipped" platform appears greyed instead of vanishing.
const PLATFORM_ORDER = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "FACEBOOK",
] as const;

type BadgeState = "posted" | "manual-pending" | "skipped" | "na";

type PostKind = "text" | "image" | "video";

function postKind(post: PostRowData): PostKind {
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  if (hasVideo) return "video";
  if (post.media.length > 0) return "image";
  return "text";
}

// Mirror of `src/lib/planner/platform-assignment.ts`. Duplicated client-side so
// we can decide between "skipped" (eligible, just wasn't sent) and "na" (this
// post type can't be cross-posted there) without a server roundtrip. FACEBOOK
// (personal) is always eligible — it's the manual paste-into-Facebook target
// and accepts every post type.
function isEligible(platform: string, kind: PostKind): boolean {
  if (platform === "FACEBOOK") return true;
  if (platform === "FACEBOOK_PAGE" || platform === "LINKEDIN") return true;
  if (platform === "INSTAGRAM") return kind !== "text";
  if (platform === "YOUTUBE" || platform === "TIKTOK") return kind === "video";
  return false;
}

function naReason(platform: string, kind: PostKind): string {
  if (platform === "INSTAGRAM") return "Instagram needs an image or video";
  if (platform === "YOUTUBE") return "YouTube needs a video";
  if (platform === "TIKTOK") return "TikTok needs a video";
  return `Not supported for ${kind} posts`;
}

interface PostedPill {
  platform: string;
  platformUrl: string | null;
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

const STATE_CLS: Record<BadgeState, string> = {
  // Subtle green tint signals "this slot is done"; brand icon stays at full
  // colour inside so the platform is still identifiable at a glance.
  posted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  // Yellow = action required (still in the manual FB queue).
  "manual-pending": "border-amber-200 bg-amber-50 text-amber-800",
  // Eligible but not posted to — user chose to skip this one.
  skipped: "border-gray-200 bg-gray-50 text-gray-400",
  // Post type can't go here — same shape as skipped but fainter.
  na: "border-gray-100 bg-gray-50/60 text-gray-300",
};

const STATE_ICON_OPACITY: Record<BadgeState, string> = {
  posted: "opacity-100",
  "manual-pending": "opacity-100",
  skipped: "opacity-50 grayscale",
  na: "opacity-30 grayscale",
};

function tooltipFor(
  state: BadgeState,
  platform: string,
  kind: PostKind,
  meta: { label: string; manual?: boolean },
): string {
  if (state === "posted") {
    return meta.manual
      ? `Marked posted to ${meta.label} — open on Facebook`
      : `Posted to ${meta.label} — open`;
  }
  if (state === "manual-pending") return `Still in the FB Personal queue — open helper`;
  if (state === "skipped") return `Not posted to ${meta.label}`;
  return naReason(platform, kind);
}

function PlatformBadge({
  platform,
  state,
  postId,
  pill,
  kind,
  onUnmarked,
}: {
  platform: string;
  state: BadgeState;
  postId: string;
  pill: PostedPill | null;
  kind: PostKind;
  onUnmarked: () => void;
}) {
  const meta = PLATFORM_META[platform];
  if (!meta) return null;
  const Icon = meta.icon;
  const tooltip = tooltipFor(state, platform, kind, meta);
  const baseCls = `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATE_CLS[state]}`;
  const iconCls = `h-3.5 w-3.5 shrink-0 ${meta.iconColor} ${STATE_ICON_OPACITY[state]}`;

  // The badge body is the "main" content (icon + label + indicator). For the
  // FB-personal Unmark variant we wrap this in a flex container and append a
  // trailing button without losing the single-pill look.
  const bodyContents = (
    <>
      <Icon className={iconCls} />
      <span className="truncate">{meta.label}</span>
      {meta.manual && state === "posted" && (
        <Hand className="h-2.5 w-2.5 shrink-0" aria-label="manual" />
      )}
      {state === "posted" && pill?.platformUrl && (
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      )}
    </>
  );

  // FB Personal + posted: inline Unmark sits *inside* the badge as a trailing
  // hit area, replacing the old separate pill. Background and border stay
  // unified so it still reads as a single chip.
  if (platform === "FACEBOOK" && state === "posted") {
    const body =
      pill?.platformUrl ? (
        <a
          href={pill.platformUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="flex items-center gap-1 truncate hover:underline"
          title={tooltip}
        >
          {bodyContents}
        </a>
      ) : (
        <span className="flex items-center gap-1 truncate" title={tooltip}>
          {bodyContents}
        </span>
      );
    return (
      <span className={`${baseCls} pr-0.5`}>
        {body}
        <InlineUnmarkButton postId={postId} onUnmarked={onUnmarked} />
      </span>
    );
  }

  // Manual-pending FB Personal: link to the helper so a tap takes you to the
  // right place to actually post on Facebook.
  if (platform === "FACEBOOK" && state === "manual-pending") {
    return (
      <Link
        href={`/admin/m/${postId}`}
        onClick={(e) => e.stopPropagation()}
        className={`${baseCls} hover:brightness-95`}
        title={tooltip}
      >
        {bodyContents}
      </Link>
    );
  }

  // Posted (non-FB) with a permalink: full-row badge is a link to the post.
  if (state === "posted" && pill?.platformUrl) {
    return (
      <a
        href={pill.platformUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${baseCls} hover:brightness-95 active:brightness-90`}
        title={tooltip}
      >
        {bodyContents}
      </a>
    );
  }

  return (
    <span className={baseCls} title={tooltip}>
      {bodyContents}
    </span>
  );
}

function InlineUnmarkButton({
  postId,
  onUnmarked,
}: {
  postId: string;
  onUnmarked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function doUnmark() {
    setBusy(true);
    try {
      const res = await fetch(`/api/posts/${postId}/manual-publish?platform=FACEBOOK`, {
        method: "DELETE",
      });
      if (res.ok) onUnmarked();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirming) void doUnmark();
        else setConfirming(true);
      }}
      disabled={busy}
      className={`ml-0.5 inline-flex h-5 items-center gap-0.5 rounded-full border-l border-l-emerald-200 pl-1.5 pr-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
        confirming
          ? "bg-red-100 text-red-800 hover:bg-red-200"
          : "text-emerald-700 hover:bg-emerald-100"
      }`}
      title={confirming ? "Click again to confirm" : "Unmark as posted on FB Personal"}
      aria-label={confirming ? "Confirm unmark" : "Unmark as posted"}
    >
      {busy ? (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      ) : (
        <Undo2 className="h-2.5 w-2.5" />
      )}
      <span>{confirming ? "Sure?" : "Unmark"}</span>
    </button>
  );
}

function PlatformBadgeRow({
  post,
  postId,
  fbPending,
  fbUnmarked,
  onUnmarkedFb,
}: {
  post: PostRowData;
  postId: string;
  fbPending: boolean;
  fbUnmarked: boolean;
  onUnmarkedFb: () => void;
}) {
  const kind = postKind(post);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PLATFORM_ORDER.map((platform) => {
        const pill =
          platform === "FACEBOOK" && fbUnmarked ? null : postedPillFor(post, platform);
        let state: BadgeState;
        if (pill) state = "posted";
        else if (platform === "FACEBOOK" && fbPending && !fbUnmarked) state = "manual-pending";
        else if (isEligible(platform, kind)) state = "skipped";
        else state = "na";
        return (
          <PlatformBadge
            key={platform}
            platform={platform}
            state={state}
            postId={postId}
            pill={pill}
            kind={kind}
            onUnmarked={onUnmarkedFb}
          />
        );
      })}
    </div>
  );
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

export function PublishedPostRow({ post, index, href, fbPending }: Props) {
  const events = collectPublishEvents(post);
  const body = displayBody(post.body);

  // Local optimistic state: when the user clicks "Unmark" on the FB Personal
  // pill, drop it from the list right away. The post stays in the Published
  // tab as long as some other platform is still PUBLISHED (the server uses
  // hubPublishCount > 0, not a single-platform flag).
  const [fbUnmarked, setFbUnmarked] = useState(false);

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
            post={post}
            postId={post.id}
            fbPending={fbPending}
            fbUnmarked={fbUnmarked}
            onUnmarkedFb={() => setFbUnmarked(true)}
          />
        </div>
      </div>
    </div>
  );
}
