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

interface PlatformPillData {
  platform: string;
  platformUrl: string | null;
}

function PlatformPill({ pill }: { pill: PlatformPillData }) {
  const meta = PLATFORM_META[pill.platform];
  if (!meta) return null;
  const Icon = meta.icon;
  const baseCls = `inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
    meta.manual
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-gray-200 bg-gray-50 text-gray-600"
  }`;
  const inner = (
    <>
      <Icon className={`h-3 w-3 shrink-0 ${meta.iconColor}`} />
      <span className="truncate">{meta.label}</span>
      {meta.manual && <Hand className="h-2.5 w-2.5 shrink-0" aria-label="manual" />}
      {pill.platformUrl && <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-70" />}
    </>
  );
  // Linkable when the PublishRecord captured a permalink (API platforms always;
  // FB personal only when the user pasted the URL in the manual-post helper).
  if (pill.platformUrl) {
    return (
      <a
        href={pill.platformUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${baseCls} hover:brightness-95 active:brightness-90`}
        title={
          meta.manual
            ? `Manually posted to ${meta.label} — open on Facebook`
            : `Posted to ${meta.label} — open`
        }
      >
        {inner}
      </a>
    );
  }
  return (
    <span
      className={baseCls}
      title={meta.manual ? `Manually posted to ${meta.label}` : `Posted to ${meta.label}`}
    >
      {inner}
    </span>
  );
}

function UnmarkFbButton({
  postId,
  onUnmarked,
}: {
  postId: string;
  onUnmarked: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function doUnmark() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/posts/${postId}/manual-publish?platform=FACEBOOK`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(data?.error ?? "Couldn't unmark");
        return;
      }
      onUnmarked();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (confirming) void doUnmark();
          else setConfirming(true);
        }}
        disabled={busy}
        className={`inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-medium transition-colors disabled:opacity-50 ${
          confirming
            ? "border-red-300 bg-red-100 text-red-800 hover:bg-red-200"
            : "border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:text-gray-700"
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
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </>
  );
}

// Stable display order for the pill row, so a post that went to FB+IG+TT
// always shows them in the same sequence (FB Personal first because it's the
// only manual one and the only one that has an Unmark control wired to it).
const PLATFORM_ORDER = [
  "FACEBOOK",
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "TIKTOK",
  "YOUTUBE",
  "LINKEDIN",
] as const;

function PlatformPills({
  pills,
  postId,
  hasFbManual,
  onUnmarkedFb,
}: {
  pills: PlatformPillData[];
  postId: string;
  hasFbManual: boolean;
  onUnmarkedFb: () => void;
}) {
  if (pills.length === 0 && !hasFbManual) return null;
  const byPlatform = new Map(pills.map((p) => [p.platform, p]));
  const ordered: string[] = [
    ...PLATFORM_ORDER.filter((p) => byPlatform.has(p)),
    // Any platform we forgot to put in PLATFORM_ORDER falls back to the end,
    // sorted alphabetically so the order at least stays stable across renders.
    ...[...byPlatform.keys()]
      .filter((p) => !(PLATFORM_ORDER as readonly string[]).includes(p))
      .sort(),
  ];
  // If FB Personal isn't already in the list but we still need to render Unmark
  // (defensive — hasFbManual implies a FACEBOOK pill in practice), prepend it
  // so Unmark has something to anchor next to.
  const hasFbPill = ordered.includes("FACEBOOK");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ordered.map((platform) => {
        const pill = byPlatform.get(platform);
        if (!pill) return null;
        // Group FB Personal + Unmark as a connected pair: same function,
        // shouldn't get split by other pills on wider rows.
        if (platform === "FACEBOOK" && hasFbManual) {
          return (
            <span key={platform} className="inline-flex items-center gap-1">
              <PlatformPill pill={pill} />
              <UnmarkFbButton postId={postId} onUnmarked={onUnmarkedFb} />
            </span>
          );
        }
        return <PlatformPill key={platform} pill={pill} />;
      })}
      {hasFbManual && !hasFbPill && (
        <UnmarkFbButton postId={postId} onUnmarked={onUnmarkedFb} />
      )}
    </div>
  );
}

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

function buildPills(post: PostRowData): PlatformPillData[] {
  // Keep only PUBLISHED records; one pill per distinct platform; prefer the
  // record that actually has a permalink (so the pill becomes an external
  // link rather than an inert chip).
  const byPlatform = new Map<string, PlatformPillData>();
  for (const p of post.publishes) {
    if (p.status !== "PUBLISHED") continue;
    const existing = byPlatform.get(p.platform);
    if (!existing || (!existing.platformUrl && p.platformUrl)) {
      byPlatform.set(p.platform, { platform: p.platform, platformUrl: p.platformUrl });
    }
  }
  return [...byPlatform.values()];
}

export function PublishedPostRow({ post, index, href }: Props) {
  const events = collectPublishEvents(post);
  const body = displayBody(post.body);

  // Local optimistic state: when the user clicks "Unmark" on the FB Personal
  // pill, drop it from the list right away. The post stays in the Published
  // tab as long as some other platform is still PUBLISHED (the server uses
  // hubPublishCount > 0, not a single-platform flag).
  const [fbUnmarked, setFbUnmarked] = useState(false);
  const visiblePills = buildPills(post).filter(
    (p) => !(fbUnmarked && p.platform === "FACEBOOK"),
  );
  const hasFbManual =
    !fbUnmarked && post.publishes.some((p) => p.platform === "FACEBOOK" && p.status === "PUBLISHED");

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
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{body}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
        </Link>
        <div className="mt-1.5">
          <PlatformPills
            pills={visiblePills}
            postId={post.id}
            hasFbManual={hasFbManual}
            onUnmarkedFb={() => setFbUnmarked(true)}
          />
        </div>
      </div>
    </div>
  );
}
