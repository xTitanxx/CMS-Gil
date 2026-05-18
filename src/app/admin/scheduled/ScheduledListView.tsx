"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  CalendarCheck,
  Image as ImageIcon,
  Loader2,
  Music,
  Play,
  Trash2,
  Video,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { dedupePlatforms } from "@/lib/planner/platforms";
import { formatSlotHour } from "@/lib/planner/format-slot";
import { displayBody } from "@/lib/post-body";
import { utcDateString } from "@/lib/planner/week";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";
import {
  PostingListView,
  type PostingSortDef,
  type PostingFilterDef,
} from "../_shared/PostingListView";
import {
  PlatformBadgeRow,
  PLATFORM_ORDER,
  isEligible,
  type PlatformBadgeState,
  type PostKind,
} from "../_shared/PlatformBadgeRow";

type StatusKind = "scheduled" | "proposed" | "published";

function statusKind(slot: PlanSlotData): StatusKind {
  if (slot.published) return "published";
  if (slot.status === "SCHEDULED") return "scheduled";
  return "proposed";
}

const STATUS_PILL: Record<StatusKind, string> = {
  scheduled: "bg-green-50 text-green-700 ring-1 ring-green-200",
  proposed: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  published: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
};

const STATUS_LABEL: Record<StatusKind, string> = {
  scheduled: "Scheduled",
  proposed: "Proposed",
  published: "Published",
};

function todayUTCKey(): string {
  const n = new Date();
  return utcDateString(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
}

function dayLabel(dayKey: string, todayKey: string): string {
  // dayKey is "yyyy-mm-dd" in UTC; reconstruct as a local Date for display.
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dayKey === todayKey) return `Today, ${format(dt, "MMM d")}`;
  return format(dt, "EEE, MMM d");
}

function slotMoment(slot: PlanSlotData): number {
  // Sort key: day + hour. Hour defaults to 0 if missing (shouldn't happen in
  // practice but we keep it deterministic).
  const [y, m, d] = slot.day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) + (slot.hour ?? 0) * 3600_000;
}

interface Item {
  slot: PlanSlotData;
  fbPending: boolean;
}

export function ScheduledListView() {
  const [plan, setPlan] = useState<WeeklyPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"clear" | "schedule-all" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Set of postIds that still need a manual FB cross-post. Populated from the
  // same endpoint the Manual FB tab uses so the two views stay in sync.
  const [fbPendingPostIds, setFbPendingPostIds] = useState<Set<string>>(new Set());

  const refreshPlan = useCallback(async () => {
    const res = await fetch("/api/planner/current");
    if (res.ok) setPlan((await res.json()) as WeeklyPlanData);
  }, []);

  const refreshFbPending = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/manual-fb-queue", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { items: { postId: string }[] };
      setFbPendingPostIds(new Set(data.items.map((i) => i.postId)));
    } catch {
      // best-effort; absence just means "no decoration", not a fatal error
    }
  }, []);

  useEffect(() => {
    void refreshPlan().finally(() => setLoading(false));
    void refreshFbPending();
  }, [refreshPlan, refreshFbPending]);

  const todayKey = todayUTCKey();

  // A slot leaves Scheduled the moment any API platform publishes — even if
  // a manual FB cross-post is still outstanding. Those already-fired posts
  // live on /admin/m (the manual-FB queue); duplicating them here just made
  // Scheduled feel cluttered with rows whose scheduling work was already done.
  const items = useMemo<Item[]>(() => {
    if (!plan) return [];
    return plan.slots
      .filter((s) => s.day >= todayKey)
      .filter((s) => !s.published)
      .map((slot) => ({ slot, fbPending: fbPendingPostIds.has(slot.postId) }));
  }, [plan, todayKey, fbPendingPostIds]);

  const activeSlots = useMemo(
    () => items.filter((i) => i.slot.status === "PROPOSED" || i.slot.status === "APPROVED"),
    [items],
  );
  const clearableSlots = useMemo(
    () =>
      items.filter(
        (i) =>
          !i.slot.published &&
          (i.slot.status === "PROPOSED" ||
            i.slot.status === "APPROVED" ||
            i.slot.status === "SCHEDULED"),
      ),
    [items],
  );

  const handleUnschedule = useCallback(
    async (slot: PlanSlotData) => {
      if (!plan) return;
      if (slot.publishRecordIds && slot.publishRecordIds.length > 0) {
        await Promise.all(
          slot.publishRecordIds.map((id) =>
            fetch(`/api/publish/${id}/cancel`, { method: "POST" }),
          ),
        );
        await refreshPlan();
        return;
      }
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove", slotId: slot.id }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan],
  );

  const handleScheduleOne = useCallback(
    async (slotId: string) => {
      if (!plan) return;
      await fetch(`/api/planner/${plan.id}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotIds: [slotId] }),
      });
      await refreshPlan();
    },
    [plan, refreshPlan],
  );

  const handleClearAll = useCallback(async () => {
    if (!plan) return;
    setBusy("clear");
    try {
      await fetch(`/api/planner/${plan.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear" }),
      });
      await refreshPlan();
    } finally {
      setBusy(null);
    }
  }, [plan, refreshPlan]);

  const handleScheduleAll = useCallback(async () => {
    if (!plan) return;
    setBusy("schedule-all");
    try {
      await fetch(`/api/planner/${plan.id}/schedule`, { method: "POST" });
      await refreshPlan();
    } finally {
      setBusy(null);
    }
  }, [plan, refreshPlan]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshPlan(), refreshFbPending()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshPlan, refreshFbPending]);

  const sortOptions = useMemo<PostingSortDef<Item>[]>(
    () => [
      {
        value: "date_asc",
        label: "Soonest first",
        compare: (a, b) => slotMoment(a.slot) - slotMoment(b.slot),
      },
      {
        value: "date_desc",
        label: "Latest first",
        compare: (a, b) => slotMoment(b.slot) - slotMoment(a.slot),
      },
      {
        value: "status",
        label: "Status",
        compare: (a, b) => {
          const order: Record<StatusKind, number> = {
            scheduled: 0,
            proposed: 1,
            published: 2,
          };
          return order[statusKind(a.slot)] - order[statusKind(b.slot)];
        },
      },
    ],
    [],
  );

  const filters = useMemo<PostingFilterDef<Item>[]>(
    () => [
      {
        id: "status",
        title: "Status",
        options: [
          { value: "proposed", label: "Proposed" },
          { value: "scheduled", label: "Scheduled" },
        ],
        valueFor: (i) => statusKind(i.slot),
      },
      {
        id: "platform",
        title: "Platform",
        options: [
          { value: "FACEBOOK", label: "Facebook" },
          { value: "INSTAGRAM", label: "Instagram" },
          { value: "TIKTOK", label: "TikTok" },
          { value: "YOUTUBE", label: "YouTube" },
          { value: "LINKEDIN", label: "LinkedIn" },
        ],
        valueFor: (i) =>
          dedupePlatforms(i.slot.platforms).map((p) =>
            p.toUpperCase() === "FACEBOOK_PAGE" ? "FACEBOOK" : p.toUpperCase(),
          ),
      },
      {
        id: "fb",
        title: "Manual FB",
        options: [
          { value: "pending", label: "Needs FB cross-post" },
          { value: "ok", label: "Doesn't need FB" },
        ],
        valueFor: (i) => (i.fbPending ? "pending" : "ok"),
      },
    ],
    [],
  );

  const bulkBar = clearableSlots.length > 0 ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={handleClearAll}
        disabled={busy !== null}
        size="sm"
        variant="outline"
        className="h-9 gap-1.5 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
      >
        {busy === "clear" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        <span>Clear all ({clearableSlots.length})</span>
      </Button>
      {activeSlots.length > 0 && (
        <Button
          onClick={handleScheduleAll}
          disabled={busy !== null}
          size="sm"
          className="ml-auto h-9 gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60"
        >
          {busy === "schedule-all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarCheck className="h-4 w-4" />
          )}
          <span>Schedule all ({activeSlots.length})</span>
        </Button>
      )}
    </div>
  ) : null;

  return (
    <PostingListView<Item>
      title="Scheduled"
      hideHeader
      items={items}
      loading={loading}
      onRefresh={refresh}
      refreshing={refreshing}
      itemNoun={{ singular: "slot", plural: "slots" }}
      getId={(i) => i.slot.id}
      searchKeys={(i) => [i.slot.post.body, ...(i.slot.post.tags ?? [])]}
      sortOptions={sortOptions}
      filters={filters}
      beforeList={bulkBar}
      emptyState={
        <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white text-sm text-gray-500">
          Nothing scheduled.
        </div>
      }
      renderRow={(item, index) => (
        <ScheduledRow
          slot={item.slot}
          queueIndex={index + 1}
          todayKey={todayKey}
          fbPending={item.fbPending}
          onUnschedule={handleUnschedule}
          onSchedule={handleScheduleOne}
        />
      )}
    />
  );
}

interface ScheduledRowProps {
  slot: PlanSlotData;
  queueIndex: number;
  todayKey: string;
  /** True when the slot has FB Personal in its platforms and FB hasn't been
   *  cross-posted yet. Shows a heads-up banner on the row. Slots whose API
   *  platforms already fired are filtered out upstream, so this only ever
   *  flags future work — never "still needs". */
  fbPending: boolean;
  onUnschedule: (slot: PlanSlotData) => Promise<void>;
  onSchedule: (slotId: string) => Promise<void>;
}

function slotPostKind(post: PlanSlotData["post"]): PostKind {
  if (post.hasVideo) return "video";
  if (post.mediaCount > 0) return "image";
  return "text";
}

function ScheduledRow({
  slot,
  queueIndex,
  todayKey,
  fbPending,
  onUnschedule,
  onSchedule,
}: ScheduledRowProps) {
  const kind = statusKind(slot);
  const { post } = slot;
  const platforms = dedupePlatforms(slot.platforms);
  const href = `/admin/posts/${post.id}?from=scheduled`;
  const dayText = dayLabel(slot.day, todayKey);
  const slotText = slot.hour != null ? formatSlotHour(slot.hour) : null;

  const postKind = slotPostKind(post);
  // Normalize selected platforms to the canonical six-slot keys used by the
  // shared badge row. The planner stores them mixed-case; the badge layer is
  // strictly uppercase.
  const selectedPlatforms = new Set(
    platforms.map((p) =>
      p.toUpperCase() === "FACEBOOK_PAGE" ? "FACEBOOK_PAGE" : p.toUpperCase(),
    ),
  );
  // FB Personal is never in slot.platforms (it's not an API target). The
  // manual-FB queue is the source of truth for "this slot will also need a
  // hand-posted FB Personal cross-post" — surface it as a scheduled badge.
  if (fbPending) selectedPlatforms.add("FACEBOOK");

  const stateByPlatform: Partial<Record<string, PlatformBadgeState>> = {};
  for (const platform of PLATFORM_ORDER) {
    if (selectedPlatforms.has(platform)) {
      stateByPlatform[platform] = "scheduled";
    } else if (isEligible(platform, postKind)) {
      stateByPlatform[platform] = "skipped";
    } else {
      stateByPlatform[platform] = "na";
    }
  }

  const remove = useAsync();
  const schedule = useAsync();

  const handleRemove = useCallback(async () => {
    await remove.run(async () => {
      await onUnschedule(slot);
    });
  }, [remove, onUnschedule, slot]);
  const { confirming, trigger } = useConfirm(handleRemove);

  const handleSchedule = useCallback(async () => {
    await schedule.run(async () => {
      await onSchedule(slot.id);
    });
  }, [schedule, onSchedule, slot.id]);

  const showSchedule = kind === "proposed";
  const outerCls = "border-gray-100 hover:border-gray-200";

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ring-1 ring-black/[0.02] transition-all hover:shadow-md ${outerCls}`}
    >
    <div className="flex items-center gap-3 p-3 md:gap-4 md:p-4">
      <Link
        href={href}
        className="relative block h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-20 md:w-20"
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
        {post.hasVideo && (
          <div
            className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5"
            title="Video"
          >
            {post.hasAudio ? (
              <Video className="h-3 w-3 text-white" />
            ) : (
              <VolumeX className="h-3 w-3 text-white" />
            )}
          </div>
        )}
        {post.hasVideo && !post.hasAudio && (
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            aria-hidden
          >
            <Play className="h-5 w-5 text-white/90 drop-shadow" fill="currentColor" />
          </div>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={href} className="block">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500"
              title={`Queue position #${queueIndex}`}
            >
              #{queueIndex}
            </span>
            <span className="text-sm font-medium text-gray-700">
              {dayText}
              {slotText && (
                <>
                  <span className="px-1 text-gray-300">·</span>
                  <span>{slotText}</span>
                </>
              )}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[kind]}`}
            >
              {STATUS_LABEL[kind]}
            </span>
            {post.hasVideo && !post.hasAudio && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 ring-1 ring-orange-200"
                title="Silent video — attach music before publishing"
              >
                <Music className="h-3 w-3" />
                Silent
              </span>
            )}
          </div>
          {displayBody(post.body) ? (
            <p className="mt-1 line-clamp-2 break-words text-sm text-gray-700">{displayBody(post.body)}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
        </Link>
        <div className="mt-1.5">
          <PlatformBadgeRow
            postId={post.id}
            kind={postKind}
            stateByPlatform={stateByPlatform}
          />
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-1 self-center">
        {showSchedule && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void handleSchedule();
            }}
            disabled={schedule.isLoading}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-green-600 px-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
            aria-label="Schedule this slot"
            title="Schedule"
          >
            {schedule.isLoading ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : (
              <CalendarCheck className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Schedule</span>
          </button>
        )}
        {confirming && (
          <span
            aria-live="polite"
            className="hidden text-[11px] font-medium text-amber-600 sm:inline"
          >
            Click again
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            trigger();
          }}
          disabled={remove.isLoading}
          className={`p-1.5 transition-colors ${
            confirming ? "text-amber-500" : "text-gray-300 hover:text-red-500"
          } disabled:opacity-60`}
          aria-label={confirming ? "Confirm remove" : "Remove from queue"}
          title={confirming ? "Click again to remove" : "Remove from queue"}
        >
          {remove.isLoading ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </div>
    </div>
  );
}
