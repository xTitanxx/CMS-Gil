"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Hand,
  Loader2,
  Undo2,
} from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

export type PostKind = "text" | "image" | "video";

// Slot states a platform badge can be in. Both Published and Scheduled rows
// render the same six slots — only the per-platform state changes.
// - posted:        publish record landed (Published only; brand-tinted chip)
// - scheduled:     slot is queued to fire at its planned time (Scheduled only)
// - overdue:       in Published, the FB Personal manual cross-post is still
//                  outstanding even though the API platforms already fired.
//                  Visually distinct from "scheduled" so the same yellow can't
//                  confusingly mean both "pending in the future" and
//                  "should've happened already".
// - skipped:       eligible platform that the user/planner chose to skip
// - na:            this post type can't be cross-posted to this platform
export type PlatformBadgeState =
  | "posted"
  | "scheduled"
  | "overdue"
  | "skipped"
  | "na";

type PlatformIconComponent = React.ComponentType<{ className?: string }>;

export const PLATFORM_META: Record<
  string,
  { label: string; icon: PlatformIconComponent; iconColor: string; manual?: boolean }
> = {
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

export const PLATFORM_ORDER = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "FACEBOOK",
] as const;

// Mirror of `src/lib/planner/platform-assignment.ts`.
export function isEligible(platform: string, kind: PostKind): boolean {
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

const STATE_CLS: Record<PlatformBadgeState, string> = {
  posted: "border-emerald-200 bg-emerald-50 text-emerald-900",
  scheduled: "border-amber-200 bg-amber-50 text-amber-800",
  // Stronger orange-red than "scheduled" so the same chrome doesn't mean both
  // "pending in the future" and "overdue / should already be done".
  overdue:
    "border-orange-300 bg-orange-100 text-orange-900 ring-1 ring-orange-200",
  // Solid border, visible text — "could have gone here, didn't."
  skipped: "border-gray-300 bg-gray-50 text-gray-500",
  // Dashed border + line-through label — "this post type can't go here at all."
  // The dashed cue reads as "not applicable" without needing a tooltip.
  na: "border-dashed border-gray-200 bg-transparent text-gray-300",
};

const STATE_ICON_OPACITY: Record<PlatformBadgeState, string> = {
  posted: "opacity-100",
  scheduled: "opacity-100",
  overdue: "opacity-100",
  skipped: "opacity-60 grayscale",
  na: "opacity-25 grayscale",
};

const STATE_LABEL_CLS: Record<PlatformBadgeState, string> = {
  posted: "",
  scheduled: "",
  overdue: "",
  skipped: "",
  na: "line-through decoration-gray-300/70",
};

export interface PostedPill {
  platform: string;
  platformUrl: string | null;
}

function tooltipFor(
  state: PlatformBadgeState,
  platform: string,
  kind: PostKind,
  meta: { label: string; manual?: boolean },
): string {
  if (state === "posted") {
    return meta.manual
      ? `Marked posted to ${meta.label} — open on Facebook`
      : `Posted to ${meta.label} — open`;
  }
  if (state === "scheduled") {
    return meta.manual
      ? `Will need a manual ${meta.label} cross-post — open helper`
      : `Scheduled to post on ${meta.label}`;
  }
  if (state === "overdue") {
    return `${meta.label} cross-post is still pending — open helper`;
  }
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
  state: PlatformBadgeState;
  postId: string;
  pill: PostedPill | null;
  kind: PostKind;
  onUnmarked?: () => void;
}) {
  const meta = PLATFORM_META[platform];
  if (!meta) return null;
  const Icon = meta.icon;
  const tooltip = tooltipFor(state, platform, kind, meta);
  const baseCls = `inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATE_CLS[state]}`;
  const iconCls = `h-3.5 w-3.5 shrink-0 ${meta.iconColor} ${STATE_ICON_OPACITY[state]}`;

  const bodyContents = (
    <>
      <Icon className={iconCls} />
      <span className={`truncate ${STATE_LABEL_CLS[state]}`}>{meta.label}</span>
      {meta.manual && state === "posted" && (
        <Hand className="h-2.5 w-2.5 shrink-0" aria-label="manual" />
      )}
      {state === "overdue" && (
        <AlertTriangle
          className="h-3 w-3 shrink-0 text-orange-700"
          aria-label="overdue"
        />
      )}
      {state === "posted" && pill?.platformUrl && (
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
      )}
    </>
  );

  // FB Personal + posted: inline Unmark button.
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
        {onUnmarked && <InlineUnmarkButton postId={postId} onUnmarked={onUnmarked} />}
      </span>
    );
  }

  // FB Personal needing manual action — open the helper. Same target whether
  // we're in Scheduled (yellow "will need") or Published (orange "overdue").
  if (platform === "FACEBOOK" && (state === "scheduled" || state === "overdue")) {
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

  // Posted with a permalink — chip is a link to the post.
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

export interface PlatformBadgeRowProps {
  postId: string;
  kind: PostKind;
  /** Per-platform state map. Missing platforms default to "skipped"
   *  (if eligible) or "na" (if the post kind can't cross-post there). */
  stateByPlatform: Partial<Record<string, PlatformBadgeState>>;
  /** Optional permalink lookup for "posted" platforms. */
  pillByPlatform?: Partial<Record<string, PostedPill | null>>;
  /** Provide to enable the Unmark control on FB Personal "posted" chip. */
  onUnmarkedFb?: () => void;
}

export function PlatformBadgeRow({
  postId,
  kind,
  stateByPlatform,
  pillByPlatform,
  onUnmarkedFb,
}: PlatformBadgeRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PLATFORM_ORDER.map((platform) => {
        let state = stateByPlatform[platform];
        if (!state) state = isEligible(platform, kind) ? "skipped" : "na";
        const pill = pillByPlatform?.[platform] ?? null;
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
