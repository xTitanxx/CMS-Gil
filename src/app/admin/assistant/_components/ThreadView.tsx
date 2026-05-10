"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Check, X, Copy, ArrowUp, SquarePen, ExternalLink, Pencil, CalendarDays, Menu, Film, ImageIcon, Type, Leaf, Clock, RotateCcw, History } from "lucide-react";
import { PostEditorModal } from "./PostEditorModal";
import { ProposalCard, type ProposalData } from "./ProposalCard";
import { HistoryPanel } from "./HistoryPanel";
import { CostPill, type CostPillHandle } from "./CostPill";
import { PLATFORM_META, dedupePlatforms } from "../../planner/PlanSlotCard";
import { formatScheduledTime } from "@/lib/planner/format-slot";

const PUBLISHABLE_PLATFORMS = ["INSTAGRAM", "FACEBOOK_PAGE", "LINKEDIN", "TIKTOK", "YOUTUBE"] as const;

const TOOL_LABELS: Record<string, string> = {
  recommend_posts: "Finding best posts",
  search_archive: "Searching archive",
  get_post: "Loading post",
  list_scheduled: "Checking schedule",
  list_planner_slots: "Checking planner",
  propose_to_planner: "Adding to planner",
  remove_planner_slot: "Removing from planner",
  approve_planner_slot: "Approving slot",
  swap_planner_slot: "Swapping post",
  clear_planner: "Clearing planner",
  schedule_planner: "Scheduling posts",
  unschedule: "Cancelling publish",
  update_post: "Updating post",
  rate_post: "Rating post",
  archive_post: "Archiving post",
  publish_now: "Publishing",
  analyze_captions: "Analyzing captions",
  caption_job_status: "Checking job status",
  save_memory: "Remembering",
  delete_memory: "Forgetting",
  list_memories: "Checking memories",
};

// Tools whose chips are hidden (planner panel / passive actions provide feedback)
const SILENT_TOOLS = new Set([
  "propose_to_planner", "remove_planner_slot", "approve_planner_slot",
  "swap_planner_slot", "clear_planner", "schedule_planner",
  "save_memory", "delete_memory",
]);

// Tools that modify planner state — trigger planner panel refresh on success.
// propose_to_planner is intentionally NOT here: it returns a proposal card; the
// V button on the card is what mutates (and triggers refresh from there).
const PLANNER_TOOLS = new Set([
  "remove_planner_slot", "approve_planner_slot",
  "swap_planner_slot", "clear_planner", "schedule_planner",
]);

type UiMsg =
  | { role: "user" | "assistant"; kind: "text"; text: string }
  | {
      role: "assistant";
      kind: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      role: "assistant";
      kind: "tool_result";
      toolUseId: string;
      result: { ok: boolean; data?: unknown; error?: string };
    };

const SUGGESTIONS = [
  "What should I post today?",
  "Plan my week",
];

interface CachedPost {
  postId: string;
  body?: string;
  tags?: string[];
  stars?: number | null;
  lifecycle?: string | null;
  thumbUrl?: string | null;
  reasons?: string[];
  platformUrl?: string | null;
  hasVideo?: boolean;
  originalDate?: string | null;
  publishCount?: number;
  /** ISO scheduledAt of the next planner placement (PublishRecord or slot). */
  nextScheduledAt?: string | null;
  /** Slot id + plan id for the next planner placement (if known). */
  nextSlotId?: string | null;
  nextPlanId?: string | null;
  /** Slot status — "PROPOSED" / "APPROVED" / "SCHEDULED" — distinguishes a planner-only
   *  slot (yellow) from a fully scheduled PublishRecord (green). */
  nextSlotStatus?: string | null;
  /** Platforms set on the matching planner slot (preferred over user defaults). */
  nextSlotPlatforms?: string[];
  loaded?: boolean;
}

// Per-content-kind publishing platforms. The full publishable set is filtered
// down to the ones that make sense for this kind of post, so e.g. an image
// post never suggests YouTube.
function platformsForContentKind(
  all: string[],
  kind: "video" | "image" | "text",
): string[] {
  if (kind === "video") return all; // every connected platform takes video.
  // Image / text: drop video-only platforms.
  const VIDEO_ONLY = new Set(["YOUTUBE", "TIKTOK"]);
  return all.filter((p) => !VIDEO_ONLY.has(p));
}

function timeSinceShort(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function reasonChipStyle(reason: string): string {
  if (/★/.test(reason)) return "border-amber-200 bg-amber-50 text-amber-700";
  if (/evergreen/i.test(reason)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (/season/i.test(reason)) return "border-teal-200 bg-teal-50 text-teal-700";
  if (/rarely|never/i.test(reason)) return "border-purple-200 bg-purple-50 text-purple-700";
  if (/tag|keyword/i.test(reason)) return "border-blue-200 bg-blue-50 text-blue-700";
  if (/stale/i.test(reason)) return "border-orange-200 bg-orange-50 text-orange-700";
  return "border-[#eae7df] bg-white/50 text-[#7a7870]";
}

// Separate regexes: one for testing (no /g), one for matching (with /g)
const POST_REF_TEST = /\[post:([a-zA-Z0-9_-]+)\]/;
const POST_REF_RE = /\[post:([a-zA-Z0-9_-]+)\]/g;

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`text-[#8e8ea0] hover:text-[#0d0d0d] transition-colors ${className ?? ""}`}
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

type ScheduleState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "scheduled"; slotId: string; planId: string; scheduledAt: string }
  | { status: "error"; message?: string };

function formatScheduledShort(iso: string): string {
  const d = new Date(iso);
  // Compact: "Mon Apr 27 12pm" — no comma so it stays on one line in tight footers.
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .replace(",", "");
  return `${day} ${formatScheduledTime(d)}`;
}

function InlinePostRef({
  post: initialPost,
  id,
  onFetched,
  onEdit,
  onSchedule,
  onUnschedule,
  userPlatforms,
}: {
  post: CachedPost | undefined;
  id: string;
  onFetched?: (post: CachedPost) => void;
  onEdit?: (postId: string) => void;
  onSchedule?: (postId: string) => Promise<{ slotId: string; planId: string; scheduledAt: string }>;
  onUnschedule?: (slotId: string, planId: string) => Promise<void>;
  userPlatforms?: string[];
}) {
  const [post, setPost] = useState(initialPost);
  const [schedule, setSchedule] = useState<ScheduleState>(() =>
    initialPost?.nextScheduledAt
      ? {
          status: "scheduled",
          scheduledAt: initialPost.nextScheduledAt,
          slotId: initialPost.nextSlotId ?? "",
          planId: initialPost.nextPlanId ?? "",
        }
      : { status: "idle" },
  );
  const fetchedRef = useRef(false);

  // Sync with prop updates (e.g. cache populated after initial render)
  useEffect(() => {
    if (initialPost) setPost(initialPost);
  }, [initialPost]);

  // Sync local schedule state with the API:
  //   - idle → scheduled when a planner placement appears
  //   - scheduled → idle when the planner placement disappears (e.g. user
  //     cancelled the slot from /admin/planner while the chat tab was open)
  // Don't touch in-progress states (sending / error) — those are user-initiated
  // and should resolve via their own callback.
  useEffect(() => {
    setSchedule((prev) => {
      if (prev.status === "sending" || prev.status === "error") return prev;
      if (post?.nextScheduledAt) {
        return {
          status: "scheduled",
          scheduledAt: post.nextScheduledAt,
          slotId: post.nextSlotId ?? "",
          planId: post.nextPlanId ?? "",
        };
      }
      // No planner placement on the post any more — drop back to idle.
      if (prev.status === "scheduled") return { status: "idle" };
      return prev;
    });
  }, [post?.nextScheduledAt, post?.nextSlotId, post?.nextPlanId]);

  // Re-fetch when fields added by recent versions of the API are missing on a
  // cached entry (older messages were cached without hasVideo / originalDate /
  // publishCount, which would otherwise leave the chip and badges stale).
  const isStale = !!post?.loaded && (
    post?.hasVideo === undefined ||
    post?.originalDate === undefined ||
    post?.publishCount === undefined
  );

  // Fetch on-demand if not in cache or if cached fields are stale
  useEffect(() => {
    if ((post?.loaded && !isStale) || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch(`/api/posts/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        // Use first image media URL as thumbnail, fall back to first media
        const imgMedia = data.media?.find((m: { mimeType: string }) => m.mimeType?.startsWith("image/"));
        const firstMedia = data.media?.[0];
        const thumb = imgMedia?.url ?? firstMedia?.url ?? null;
        const hasVideo = Array.isArray(data.media) &&
          data.media.some((m: { mimeType?: string }) => m.mimeType?.startsWith("video/"));
        const fetched: CachedPost = {
          postId: id,
          body: data.body,
          tags: data.tags,
          stars: data.rating?.stars ?? null,
          lifecycle: data.lifecycle,
          thumbUrl: thumb,
          platformUrl: data.platformUrl ?? null,
          hasVideo,
          originalDate: data.originalDate ?? null,
          publishCount: typeof data.publishCount === "number" ? data.publishCount : 0,
          nextScheduledAt: data.nextScheduledAt ?? null,
          nextSlotId: data.nextSlotId ?? null,
          nextPlanId: data.nextPlanId ?? null,
          nextSlotStatus: data.nextSlotStatus ?? null,
          nextSlotPlatforms: Array.isArray(data.nextSlotPlatforms) ? data.nextSlotPlatforms : [],
          loaded: true,
        };
        setPost(fetched);
        onFetched?.(fetched);
      })
      .catch(() => {});
  }, [id, post?.loaded, isStale, onFetched]);

  const href = `/admin/posts/${id}?from=assistant`;
  if (!post?.loaded) {
    return (
      <a
        href={href}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
      >
        post:{id.slice(0, 6)}…
      </a>
    );
  }
  const body = (post.body ?? "").replace(/\s+/g, " ").trim();
  // Prefer the explicit hasVideo flag from the API; fall back to URL hints for
  // cached entries that pre-date that field.
  const isVideo = post.hasVideo ?? (
    post.thumbUrl?.includes("/video/") || post.thumbUrl?.endsWith(".mp4") || post.thumbUrl?.endsWith(".mov") || false
  );
  const ContentIcon = isVideo ? Film : post.thumbUrl ? ImageIcon : Type;
  const contentLabel = isVideo ? "Video" : post.thumbUrl ? "Image" : "Text";
  const stars = post.stars ?? null;
  // Hide reason chips that just restate visible badges:
  //   - "5★" duplicates the stars chip
  //   - "evergreen" duplicates the green leaf
  //   - "never posted" / "rarely reposted" duplicate the "Never reposted" /
  //     "Reposted N×" chip on the top row
  const isEvergreen = post.lifecycle === "EVERGREEN";
  const visibleReasons = post.reasons?.filter((r) => {
    if (/^\s*\d+\s*★\s*$/.test(r)) return false;
    if (isEvergreen && /^\s*evergreen\s*$/i.test(r)) return false;
    if (typeof post.publishCount === "number") {
      if (post.publishCount === 0 && /^\s*never posted\s*$/i.test(r)) return false;
      if (/^\s*rarely reposted\s*$/i.test(r)) return false;
    }
    return true;
  });
  const showReasons = visibleReasons && visibleReasons.length > 0;
  const showTags = !showReasons && post.tags && post.tags.length > 0;
  // Prefer the platforms recorded on the matching planner slot (so chat mirrors
  // what the planner shows). Fall back to the user's connected publishable
  // platforms — filtered to the ones that fit this post's content kind so an
  // image post never suggests YouTube.
  const contentKindForPlatforms: "video" | "image" | "text" = isVideo
    ? "video"
    : post.thumbUrl
      ? "image"
      : "text";
  const platformsToShow = post.nextSlotPlatforms && post.nextSlotPlatforms.length > 0
    ? post.nextSlotPlatforms
    : platformsForContentKind(userPlatforms ?? [], contentKindForPlatforms);

  // Determine card state from BOTH the local schedule state and the slot
  // status returned by the API. A slot in PROPOSED/APPROVED is yellow
  // ("Proposed"); SCHEDULED + an actual PublishRecord is green ("Scheduled").
  const slotIsScheduled = post.nextSlotStatus === "SCHEDULED";
  const slotIsProposed =
    post.nextSlotStatus === "PROPOSED" || post.nextSlotStatus === "APPROVED";
  const isScheduled =
    schedule.status === "scheduled" && (slotIsScheduled || !post.nextSlotStatus);
  const isProposedSlot = schedule.status === "scheduled" && slotIsProposed;
  const cardBg = isScheduled
    ? "border-[#d6e4d3] bg-[#f0f6ef]"
    : "border-[#ebe3cc] bg-[#fbf7ee]";
  const footerBg = isScheduled ? "bg-[#e6ede5]/60" : "bg-[#f5f0e3]/60";
  const dotBg = isScheduled ? "bg-green-500" : "bg-[#d4a23e]";

  async function handleScheduleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!onSchedule) return;
    if (schedule.status === "sending" || schedule.status === "scheduled") return;
    setSchedule({ status: "sending" });
    try {
      const result = await onSchedule(id);
      setSchedule({ status: "scheduled", ...result });
    } catch (err) {
      setSchedule({ status: "error", message: err instanceof Error ? err.message : undefined });
    }
  }

  async function handleUnscheduleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (schedule.status !== "scheduled" || !onUnschedule) return;
    const { slotId, planId } = schedule;
    setSchedule({ status: "sending" });
    try {
      await onUnschedule(slotId, planId);
      setSchedule({ status: "idle" });
    } catch (err) {
      // Restore prior scheduled state so the user can retry
      setSchedule({ status: "error", message: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <a
      href={href}
      className={`group/card relative my-2 block overflow-hidden rounded-[14px] border shadow-sm transition-shadow hover:shadow-md ${cardBg}`}
    >
      {/* Floating actions — edit / external / copy. Schedule moved to footer. */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(id);
            }}
            className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm text-[#0d0d0d] hover:text-black transition-colors"
            aria-label="Edit post"
            title="Edit post"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {post.platformUrl && (
          <a
            href={post.platformUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm text-blue-600 hover:text-blue-700 transition-colors"
            aria-label="View original post"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <CopyButton
          text={post.body ?? ""}
          className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm"
        />
      </div>

      {post.thumbUrl && (
        <div className="relative w-full overflow-hidden bg-gray-100">
          {/* thumbUrl is .poster.jpg for videos (see buildThumbUrl), so always render as <img>.
              Natural aspect ratio (w-full h-auto) so portraits and landscapes show
              uncropped; max-h caps very tall portraits so the card doesn't dominate. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbUrl} alt="" className="block h-auto w-full max-h-[70vh] object-contain" />
          {isVideo && (
            <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
              <Film className="h-4 w-4" />
            </span>
          )}
        </div>
      )}

      <div className="p-3.5 md:p-4">
        {/* Row 1: type · leaf · stars · ··· · Originally · Reposted */}
        <div className={`flex flex-wrap items-center gap-1.5 ${!post.thumbUrl ? "pr-28" : ""}`}>
          <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#3a3832]">
            <ContentIcon className="h-3 w-3 text-[#7a7870]" />
            {contentLabel}
          </span>
          {post.lifecycle === "EVERGREEN" && (
            <span title="Evergreen"><Leaf className="h-3.5 w-3.5 text-green-500" /></span>
          )}
          {stars != null && stars > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-[8px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
              title={`${stars}/5`}
              aria-label={`${stars} out of 5 stars`}
            >
              <span aria-hidden="true">{stars}★</span>
            </span>
          )}
          <span className="flex-1" />
          {post.originalDate && (
            <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/50 px-2 py-0.5 text-[11px] text-[#7a7870]">
              <Clock className="h-3 w-3" />
              Originally {timeSinceShort(post.originalDate)}
            </span>
          )}
          {typeof post.publishCount === "number" && (
            <span className={`inline-flex items-center gap-1 rounded-[8px] border px-2 py-0.5 text-[11px] ${
              post.publishCount > 0
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-[#eae7df] bg-white/50 text-[#7a7870]"
            }`}>
              <RotateCcw className="h-3 w-3" />
              {post.publishCount > 0 ? `Reposted ${post.publishCount}×` : "Never reposted"}
            </span>
          )}
        </div>

        {/* Row 2: body — bigger + more lines so the caption is the focus */}
        {body ? (
          <p className="mt-2.5 line-clamp-[6] text-[15px] leading-[1.55] text-[#161513]">{body}</p>
        ) : (
          <p className="mt-2.5 text-[13px] italic text-gray-400">No caption</p>
        )}

        {/* Row 3: reason chips (or tag fallback) */}
        {showReasons && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {visibleReasons!.map((r, i) => (
              <span
                key={i}
                className={`inline-flex items-center rounded-[8px] border px-2 py-0.5 text-[11px] ${reasonChipStyle(r)}`}
              >
                {r}
              </span>
            ))}
          </div>
        )}
        {showTags && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {post.tags!.slice(0, 3).map((t, i) => (
              <span
                key={i}
                className="inline-flex items-center rounded-[8px] border border-[#eae7df] bg-white/50 px-2 py-0.5 text-[11px] text-[#7a7870]"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Status footer — parallel to PlanSlotCard: dot · label · date · spacer · platforms · V/X */}
      {onSchedule && (
        <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-black/5 px-3.5 py-2.5 text-[12px] md:px-4 ${footerBg}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${dotBg}`} />
          <span className="shrink-0 font-semibold text-[#3a3832]">
            {isScheduled
              ? "Scheduled"
              : isProposedSlot
                ? "Proposed"
                : schedule.status === "error"
                  ? "Schedule failed"
                  : "Recommended"}
          </span>
          {/* Show day+time whenever we have a planner placement (proposed OR
              scheduled). Recommended state has no time — nothing's been
              committed yet. */}
          {schedule.status === "scheduled" && (
            <span className="shrink-0 whitespace-nowrap text-[#7a7870]">
              · <span className="font-semibold text-[#161513]">{formatScheduledShort(schedule.scheduledAt)}</span>
            </span>
          )}
          <span className="flex-1" />
          {dedupePlatforms(platformsToShow).map((p) => {
            const meta = PLATFORM_META[p];
            if (!meta) return null;
            return <meta.Icon key={p} className={`h-4 w-4 shrink-0 ${meta.color}`} />;
          })}
          {(isScheduled || isProposedSlot) ? (
            schedule.slotId && schedule.planId ? (
              <button
                type="button"
                onClick={handleUnscheduleClick}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#d6e4d3] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832]"
                title={isScheduled ? "Cancel scheduled post" : "Remove from planner"}
                aria-label={isScheduled ? "Cancel scheduled post" : "Remove from planner"}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null
          ) : (
            <button
              type="button"
              onClick={handleScheduleClick}
              disabled={schedule.status === "sending"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#161513] text-white hover:opacity-80 disabled:opacity-60"
              title={schedule.status === "error" ? "Try scheduling again" : "Schedule to next slot"}
              aria-label={schedule.status === "error" ? "Try scheduling again" : "Schedule to next slot"}
            >
              {schedule.status === "sending" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
              )}
            </button>
          )}
        </div>
      )}
    </a>
  );
}

function renderTextWithRefs(
  text: string,
  cache: Map<string, CachedPost>,
  onPostFetched?: (post: CachedPost) => void,
  onEdit?: (postId: string) => void,
  onSchedule?: (postId: string) => Promise<{ slotId: string; planId: string; scheduledAt: string }>,
  onUnschedule?: (slotId: string, planId: string) => Promise<void>,
  userPlatforms?: string[],
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let keyN = 0;
  // Create a fresh regex each time to avoid lastIndex issues
  const re = /\[post:([a-zA-Z0-9_-]+)\]/g;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const id = match[1];
    out.push(
      <InlinePostRef
        key={`ref-${keyN++}`}
        post={cache.get(id)}
        id={id}
        onFetched={onPostFetched}
        onEdit={onEdit}
        onSchedule={onSchedule}
        onUnschedule={onUnschedule}
        userPlatforms={userPlatforms}
      />,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ThreadViewProps {
  onPlanProposed?: () => void;
  onOpenPlanner?: () => void;
}

export function ThreadView({ onPlanProposed, onOpenPlanner }: ThreadViewProps) {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const costPillRef = useRef<CostPillHandle>(null);
  const [input, setInput] = useState("");
  const [postCache, setPostCache] = useState<Map<string, CachedPost>>(new Map());
  const [proposalsByToolUseId, setProposalsByToolUseId] = useState<Map<string, ProposalData>>(new Map());
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // User's connected publishing platforms — used as the suggested platforms on
  // inline post cards. Fetched once on mount.
  const [userPlatforms, setUserPlatforms] = useState<string[]>([]);

  // Re-fetch cached posts when the tab regains focus / visibility, so that
  // cancelling a slot from /admin/planner (or any other route) flips the
  // corresponding chat card back to its real state instead of staying green
  // until the conversation is reloaded.
  useEffect(() => {
    function refreshCachedPosts() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setPostCache((prev) => {
        const ids = Array.from(prev.keys());
        if (ids.length === 0) return prev;
        Promise.all(
          ids.map((id) =>
            fetch(`/api/posts/${id}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((data) => (data ? { id, data } : null))
              .catch(() => null),
          ),
        ).then((results) => {
          setPostCache((current) => {
            const next = new Map(current);
            for (const r of results) {
              if (!r) continue;
              const existing = next.get(r.id);
              if (!existing) continue;
              next.set(r.id, {
                ...existing,
                nextScheduledAt: r.data.nextScheduledAt ?? null,
                nextSlotId: r.data.nextSlotId ?? null,
                nextPlanId: r.data.nextPlanId ?? null,
                nextSlotStatus: r.data.nextSlotStatus ?? null,
                nextSlotPlatforms: Array.isArray(r.data.nextSlotPlatforms)
                  ? r.data.nextSlotPlatforms
                  : [],
              });
            }
            return next;
          });
        });
        return prev;
      });
    }
    window.addEventListener("focus", refreshCachedPosts);
    document.addEventListener("visibilitychange", refreshCachedPosts);
    return () => {
      window.removeEventListener("focus", refreshCachedPosts);
      document.removeEventListener("visibilitychange", refreshCachedPosts);
    };
  }, []);

  useEffect(() => {
    fetch("/api/connections")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const publishable = new Set<string>(PUBLISHABLE_PLATFORMS);
        const tokens = (data.tokens as { platform?: string }[] | undefined) ?? [];
        const platforms = tokens
          .map((t) => t.platform)
          .filter((p): p is string => typeof p === "string" && publishable.has(p));
        if (data?.youtube?.connected) platforms.push("YOUTUBE");
        setUserPlatforms(dedupePlatforms(Array.from(new Set(platforms))));
      })
      .catch(() => {});
  }, []);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether the user is "pinned" to the bottom — when true, new content
  // auto-scrolls; when false (user scrolled up to read), we leave them alone.
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Maps toolUseId → tool name so we can identify planner-related results
  const toolUseNamesRef = useRef<Map<string, string>>(new Map());


  function seedCacheFromToolResult(
    result: { ok: boolean; data?: unknown },
    toolUseId?: string,
  ) {
    if (!result.ok) return;
    const data = result.data as unknown;
    const entries: CachedPost[] = [];

    // Proposal payload: store in proposalsByToolUseId + seed post into cache
    if (
      data &&
      typeof data === "object" &&
      (data as { kind?: string }).kind === "proposal"
    ) {
      const proposal = data as ProposalData;
      if (toolUseId) {
        setProposalsByToolUseId((prev) => {
          const next = new Map(prev);
          next.set(toolUseId, proposal);
          return next;
        });
      }
      const p = proposal.post;
      entries.push({
        postId: p.id,
        body: p.body,
        tags: p.tags,
        stars: p.rating ?? null,
        lifecycle: p.lifecycle ?? null,
        thumbUrl: p.thumbUrl ?? null,
        platformUrl: p.platformUrl ?? null,
        hasVideo: p.hasVideo ?? false,
        originalDate: p.originalDate ?? null,
        publishCount: typeof p.publishCount === "number" ? p.publishCount : 0,
        loaded: true,
      });
    } else if (Array.isArray(data)) {
      for (const raw of data as Record<string, unknown>[]) {
        if (!raw?.postId) continue;
        const item = raw as unknown as CachedPost;
        // Normalize matchReasons (search) to reasons (recommend)
        if (!item.reasons && Array.isArray(raw.matchReasons)) {
          item.reasons = raw.matchReasons as string[];
        }
        // recommend_posts / search_archive return contentKind but not a separate
        // hasVideo flag. Derive it so the inline card shows "Video" + the right
        // platform set instead of falling back to "Image" via a broken URL hint
        // (buildThumbUrl rewrites the extension to .poster.jpg, so the URL
        // never ends in .mp4 / .mov anyway).
        if (item.hasVideo === undefined && typeof raw.contentKind === "string") {
          item.hasVideo = raw.contentKind === "video";
        }
        item.loaded = true;
        entries.push(item);
      }
    } else if (data && typeof data === "object" && "id" in data) {
      const p = data as { id: string; body?: string; tags?: string[]; rating?: { stars?: number } | null; lifecycle?: string; media?: { mimeType?: string; url?: string; storageKey?: string }[] };
      // Extract thumbnail: prefer first image media URL, fall back to first media
      const imgMedia = p.media?.find((m) => m.mimeType?.startsWith("image/"));
      const firstMedia = p.media?.[0];
      const thumb = imgMedia?.url ?? firstMedia?.url ?? null;
      entries.push({
        postId: p.id,
        body: p.body,
        tags: p.tags,
        stars: p.rating?.stars ?? null,
        lifecycle: p.lifecycle ?? null,
        thumbUrl: thumb,
        loaded: true,
      });
    }
    if (!entries.length) return;
    setPostCache((prev) => {
      const next = new Map(prev);
      for (const e of entries) {
        const existing = next.get(e.postId);
        next.set(e.postId, { ...existing, ...e });
      }
      return next;
    });
  }

  // Replace state with a fully rehydrated conversation. Used both for the
  // initial "resume latest" load and when the user picks a past conversation
  // from the history panel.
  const applyConversation = useCallback(
    (conv: { id: string; messages: { role: string; content: unknown[] }[] }) => {
      toolUseNamesRef.current.clear();
      setProposalsByToolUseId(new Map());
      setPostCache(new Map());
      setConversationId(conv.id);
      const rehydrated: UiMsg[] = [];
      for (const m of conv.messages) {
        for (const block of m.content) {
          const b = block as { kind: string };
          if (b.kind === "text") {
            rehydrated.push({
              role: m.role as "user" | "assistant",
              kind: "text",
              text: (b as unknown as { text: string }).text,
            });
          } else if (b.kind === "tool_use") {
            const tu = b as unknown as { id: string; name: string; input: Record<string, unknown> };
            toolUseNamesRef.current.set(tu.id, tu.name);
            rehydrated.push({
              role: "assistant",
              kind: "tool_use",
              ...tu,
            });
          } else if (b.kind === "tool_result") {
            const tr = b as unknown as { toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };
            rehydrated.push({
              role: "assistant",
              kind: "tool_result",
              ...tr,
            });
            seedCacheFromToolResult(tr.result, tr.toolUseId);
          }
        }
      }
      setMessages(rehydrated);
    },
    [],
  );

  const loadConversationById = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/assistant/thread/${id}`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.conversation) applyConversation(d.conversation);
    },
    [applyConversation],
  );

  // Resume latest thread on mount
  useEffect(() => {
    fetch("/api/assistant/thread")
      .then((r) => r.json())
      .then((d) => {
        if (!d.conversation) return;
        applyConversation(d.conversation);
      })
      .catch(() => {
        /* no saved thread yet */
      });
  }, [applyConversation]);

  // Smart auto-scroll: only stay pinned to the bottom if the user hasn't
  // scrolled up. Without this guard the unconditional scrollIntoView fires on
  // every streaming text delta and yanks the user back, making manual scroll
  // feel "stuck".
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = distFromBottom < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    // "auto" (instant) during streaming so we don't queue smooth animations
    // that fight rapid delta updates; "smooth" only when streaming finishes.
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  async function send(text: string) {
    const userMsg: UiMsg = { role: "user", kind: "text", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    // Reset textarea height after clearing
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStreaming(true);

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (!res.ok || !res.body) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch { /* no JSON body */ }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", kind: "text", text: `Something went wrong (${detail}). Please try again.` },
      ]);
      setStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.kind === "conversation") {
            setConversationId(evt.id);
          } else if (evt.kind === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.kind === "text") {
                return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }];
              }
              return [...prev, { role: "assistant", kind: "text", text: evt.text }];
            });
          } else if (evt.kind === "tool_use") {
            toolUseNamesRef.current.set(evt.id, evt.name);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                kind: "tool_use",
                id: evt.id,
                name: evt.name,
                input: evt.input,
              },
            ]);
          } else if (evt.kind === "error") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", kind: "text", text: evt.message ?? "Something went wrong. Try again." },
            ]);
          } else if (evt.kind === "tool_result") {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                kind: "tool_result",
                toolUseId: evt.toolUseId,
                result: evt.result,
              },
            ]);
            seedCacheFromToolResult(evt.result, evt.toolUseId);
            if (evt.result.ok && PLANNER_TOOLS.has(toolUseNamesRef.current.get(evt.toolUseId) ?? "")) {
              onPlanProposed?.();
            }
          }
        } catch {
          /* swallow partial/bad lines */
        }
      }
    }
    setStreaming(false);
    costPillRef.current?.refresh();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = input.trim();
      if (v && !streaming) send(v);
    }
  }

  // Pre-compute tool_use groups: consecutive same-name tool calls collapse into one chip
  const toolGroups = useMemo(() => {
    const hidden = new Set<string>(); // tool_use IDs to skip rendering
    const leaders = new Map<string, { ids: string[] }>(); // first ID → all IDs in group

    const toolUses = messages
      .map((m, i) => (m.kind === "tool_use" ? { ...m, idx: i } : null))
      .filter(Boolean) as (Extract<UiMsg, { kind: "tool_use" }> & { idx: number })[];

    let i = 0;
    while (i < toolUses.length) {
      const start = toolUses[i];
      const ids = [start.id];
      let j = i + 1;
      // Group consecutive (by original index) tool_uses with the same name
      while (j < toolUses.length && toolUses[j].name === start.name && toolUses[j].idx === toolUses[j - 1].idx + 1) {
        ids.push(toolUses[j].id);
        hidden.add(toolUses[j].id);
        j++;
      }
      if (ids.length > 1) {
        leaders.set(start.id, { ids });
      }
      i = j;
    }
    return { hidden, leaders };
  }, [messages]);

  const handlePostFetched = useCallback((fetched: CachedPost) => {
    setPostCache((prev) => {
      const next = new Map(prev);
      next.set(fetched.postId, { ...prev.get(fetched.postId), ...fetched });
      return next;
    });
  }, []);

  const handleEditPost = useCallback((postId: string) => {
    setEditingPostId(postId);
  }, []);

  const handleEditorSaved = useCallback(
    (postId: string, patch: { body?: string; thumbUrl?: string | null }) => {
      setPostCache((prev) => {
        const existing = prev.get(postId);
        if (!existing && !patch.body && patch.thumbUrl == null) return prev;
        const next = new Map(prev);
        next.set(postId, {
          ...existing,
          postId,
          loaded: true,
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.thumbUrl !== undefined ? { thumbUrl: patch.thumbUrl } : {}),
        });
        return next;
      });
    },
    [],
  );

  const handleProposalApprove = useCallback(
    async (proposal: ProposalData) => {
      const res = await fetch("/api/planner/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: proposal.postId,
          day: proposal.day,
          hour: proposal.hour,
          platforms: proposal.platforms,
          reasoning: proposal.reasoning,
        }),
      });
      if (!res.ok) throw new Error(`propose failed: ${res.status}`);
      const data = (await res.json()) as { slotId: string; planId: string };
      onPlanProposed?.();
      return { slotId: data.slotId, planId: data.planId };
    },
    [onPlanProposed],
  );

  const handleQuickSchedule = useCallback(
    async (postId: string) => {
      const res = await fetch(`/api/posts/${postId}/quick-schedule`, {
        method: "POST",
      });
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = body.error;
        } catch { /* no JSON body */ }
        throw new Error(`quick-schedule failed: ${detail}`);
      }
      const data = (await res.json()) as { slotId: string; planId: string; scheduledAt: string };
      onPlanProposed?.();
      return { slotId: data.slotId, planId: data.planId, scheduledAt: data.scheduledAt };
    },
    [onPlanProposed],
  );

  const handleQuickUnschedule = useCallback(
    async (slotId: string, planId: string) => {
      const res = await fetch(`/api/planner/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", slotId }),
      });
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) detail = body.error;
        } catch { /* no JSON body */ }
        throw new Error(`unschedule failed: ${detail}`);
      }
      onPlanProposed?.();
    },
    [onPlanProposed],
  );

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      if (m.role === "user") {
        return (
          <div key={key} className="flex justify-end">
            <div className="max-w-[80%] rounded-3xl rounded-br-md px-4 py-3 text-xl leading-normal whitespace-pre-wrap bg-[#f4f4f4] text-[#0d0d0d]">
              {m.text}
            </div>
          </div>
        );
      }
      return (
        <div key={key} className="flex items-start gap-2 justify-start">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white mt-0.5">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 max-w-[85%] text-xl leading-normal whitespace-pre-wrap text-[#0d0d0d]">
            {renderTextWithRefs(m.text, postCache, handlePostFetched, handleEditPost, handleQuickSchedule, handleQuickUnschedule, userPlatforms)}
            <div className="mt-2 flex items-center gap-3">
              <CopyButton text={m.text.replace(/\[post:[a-zA-Z0-9_-]+\]/g, "").trim()} />
            </div>
          </div>
        </div>
      );
    }
    if (m.kind === "tool_use") {
      if (SILENT_TOOLS.has(m.name)) return null;

      // Check if this tool_use ID is part of a group and not the leader
      if (toolGroups.hidden.has(m.id)) return null;

      const group = toolGroups.leaders.get(m.id);
      const count = group ? group.ids.length : 1;
      const groupIds = group ? group.ids : [m.id];

      // Check results for all IDs in the group
      const doneCount = groupIds.filter((id) =>
        messages.some((msg) => msg.kind === "tool_result" && msg.toolUseId === id),
      ).length;
      const errorCount = groupIds.filter((id) =>
        messages.some(
          (msg) => msg.kind === "tool_result" && msg.toolUseId === id && !msg.result.ok,
        ),
      ).length;
      // If streaming is done and some results never arrived, treat as done
      const allDone = doneCount === groupIds.length || !streaming;
      const anyError = errorCount > 0 || (!streaming && doneCount < groupIds.length);

      const label = TOOL_LABELS[m.name] ?? m.name;
      const countLabel = count > 1 ? ` (${allDone ? count : `${doneCount}/${count}`})` : "";

      const statusText = allDone
        ? anyError
          ? `${label}${countLabel} failed`
          : `${label}${countLabel} done`
        : `${label}${countLabel} in progress`;

      return (
        <div
          key={key}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={statusText}
          className="pl-9 flex items-center gap-1.5 py-0.5"
        >
          {allDone ? (
            anyError ? (
              <X className="h-3 w-3 text-red-400 flex-shrink-0" aria-hidden="true" />
            ) : (
              <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" aria-hidden="true" />
            )
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-[#8e8ea0] flex-shrink-0" aria-hidden="true" />
          )}
          <span
            className={`text-xs ${
              allDone
                ? anyError
                  ? "text-red-400"
                  : "text-gray-400"
                : "text-[#8e8ea0]"
            }`}
          >
            {label}{countLabel}{allDone ? "" : "…"}
          </span>
          {anyError && (
            <span className="text-xs text-red-400">
              — {doneCount < groupIds.length ? `${groupIds.length - doneCount} timed out` : `${errorCount} failed`}
            </span>
          )}
        </div>
      );
    }
    if (m.kind === "tool_result") {
      const proposal = proposalsByToolUseId.get(m.toolUseId);
      if (proposal) {
        return (
          <div key={key} className="pl-9">
            <ProposalCard
              proposal={proposal}
              onApprove={handleProposalApprove}
              onCancel={handleQuickUnschedule}
            />
          </div>
        );
      }
      // Other tool_result rendering is handled by the tool_use chip above.
      return null;
    }
    return null;
  }

  return (
    <div className="relative h-full bg-white">
      {/* Floating mobile burger (top-left) — assistant has no MobilePageHeader */}
      <div
        className="absolute left-2 z-30 md:hidden"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        <button
          onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 active:bg-white/85 touch-manipulation focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Floating action buttons (top-right): cost pill + Planner + History + New chat */}
      <div
        className="absolute right-2 z-30 flex items-center gap-1.5"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        <CostPill ref={costPillRef} />
        {onOpenPlanner && (
          <button
            onClick={() => onOpenPlanner()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 hover:bg-white/85 active:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            aria-label="Open planner"
            title="Planner"
          >
            <CalendarDays className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={() => setHistoryOpen(true)}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 hover:bg-white/85 active:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-label="Chat history"
          title="History"
        >
          <History className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <button
          onClick={async () => {
            if (messages.length === 0) return;
            await fetch("/api/assistant/thread", { method: "DELETE" });
            setMessages([]);
            setConversationId(null);
            toolUseNamesRef.current.clear();
            setProposalsByToolUseId(new Map());
          }}
          disabled={streaming || messages.length === 0}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/75 text-[#0d0d0d] ring-1 ring-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_6px_18px_rgba(0,0,0,0.18)] backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 hover:bg-white/85 active:bg-white/90 disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          aria-label="New chat"
          title="New chat"
        >
          <SquarePen className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      <HistoryPanel
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        currentConversationId={conversationId}
        onSelect={async (id) => {
          if (streaming) return;
          if (id === conversationId) {
            setHistoryOpen(false);
            return;
          }
          await loadConversationById(id);
          setHistoryOpen(false);
        }}
      />

      {/* Messages — full-height scroll, padding at top to clear floating buttons,
          padding at bottom to clear floating composer. */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto px-3 pb-32 pt-[max(calc(env(safe-area-inset-top,0px)+3.5rem),4rem)] md:px-4 md:pt-14"
      >
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#0d0d0d] text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-base font-medium text-[#0d0d0d]">How can I help?</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => renderMsg(m, i))}

          {streaming && (() => {
            // Find the last tool_use without a matching result to show active tool
            const lastToolUse = [...messages].reverse().find(
              (msg): msg is Extract<UiMsg, { kind: "tool_use" }> => msg.kind === "tool_use",
            );
            const hasResult = lastToolUse && messages.some(
              (msg) => msg.kind === "tool_result" && msg.toolUseId === lastToolUse.id,
            );
            const activeLabel = lastToolUse && !hasResult
              ? TOOL_LABELS[lastToolUse.name] ?? lastToolUse.name
              : null;

            return (
              <div className="flex items-start gap-2 justify-start">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#8e8ea0]" />
                  <span className="text-sm text-[#8e8ea0]">
                    {activeLabel ? `${activeLabel}...` : "Thinking..."}
                  </span>
                </div>
              </div>
            );
          })()}
          <div ref={bottomRef} />
        </div>
      </div>


      {/* Floating composer — sits above the scroll area, text flows underneath. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 md:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-4xl">
          <div className="flex items-center rounded-3xl border border-black/5 bg-white/70 py-1 pl-1.5 pr-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              enterKeyHint="send"
              placeholder="Ask Assistant"
              aria-label="Message"
              rows={1}
              className="flex-1 resize-none self-center bg-transparent px-1.5 py-2 text-lg leading-5 text-[#0d0d0d] placeholder-[#8e8ea0] focus:outline-none"
              style={{ height: "auto", maxHeight: "120px", overflow: "auto" }}
            />
            {(() => {
              const canSend = input.trim().length > 0 && !streaming;
              return (
                <button
                  type="button"
                  onClick={() => {
                    const v = input.trim();
                    if (v && !streaming) send(v);
                  }}
                  disabled={!canSend}
                  className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white transition-colors disabled:bg-[#e5e5e5] disabled:text-[#8e8ea0] disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  aria-label="Send"
                >
                  <ArrowUp className="h-5 w-5" />
                </button>
              );
            })()}
          </div>
        </div>
      </div>

      {editingPostId && (
        <PostEditorModal
          postId={editingPostId}
          onClose={() => setEditingPostId(null)}
          onSaved={(patch) => handleEditorSaved(editingPostId, patch)}
        />
      )}
    </div>
  );
}
