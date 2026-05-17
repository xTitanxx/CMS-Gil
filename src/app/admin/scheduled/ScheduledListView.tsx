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
import { dedupePlatforms, PLATFORM_META } from "@/lib/planner/platforms";
import { formatSlotHour } from "@/lib/planner/format-slot";
import { displayBody } from "@/lib/post-body";
import { utcDateString } from "@/lib/planner/week";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

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

export function ScheduledListView() {
  const [plan, setPlan] = useState<WeeklyPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"clear" | "schedule-all" | null>(null);

  const refreshPlan = useCallback(async () => {
    const res = await fetch("/api/planner/current");
    if (res.ok) setPlan((await res.json()) as WeeklyPlanData);
  }, []);

  useEffect(() => {
    void refreshPlan().finally(() => setLoading(false));
  }, [refreshPlan]);

  const todayKey = todayUTCKey();

  const upcoming = useMemo(() => {
    if (!plan) return [];
    return plan.slots
      .filter((s) => s.day >= todayKey)
      .sort((a, b) => {
        if (a.day !== b.day) return a.day < b.day ? -1 : 1;
        const ha = a.hour ?? -1;
        const hb = b.hour ?? -1;
        return ha - hb;
      });
  }, [plan, todayKey]);

  const activeSlots = useMemo(
    () => upcoming.filter((s) => s.status === "PROPOSED" || s.status === "APPROVED"),
    [upcoming],
  );
  const clearableSlots = useMemo(
    () =>
      upcoming.filter(
        (s) =>
          !s.published &&
          (s.status === "PROPOSED" || s.status === "APPROVED" || s.status === "SCHEDULED"),
      ),
    [upcoming],
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

  if (loading && !plan) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {clearableSlots.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
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
      )}

      {upcoming.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white text-sm text-gray-500">
          Nothing scheduled.
        </div>
      ) : (
        <div className="space-y-2">
          {upcoming.map((slot, index) => (
            <ScheduledRow
              key={slot.id}
              slot={slot}
              queueIndex={index + 1}
              todayKey={todayKey}
              onUnschedule={handleUnschedule}
              onSchedule={handleScheduleOne}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ScheduledRowProps {
  slot: PlanSlotData;
  queueIndex: number;
  todayKey: string;
  onUnschedule: (slot: PlanSlotData) => Promise<void>;
  onSchedule: (slotId: string) => Promise<void>;
}

function ScheduledRow({ slot, queueIndex, todayKey, onUnschedule, onSchedule }: ScheduledRowProps) {
  const kind = statusKind(slot);
  const { post } = slot;
  const platforms = dedupePlatforms(slot.platforms);
  const href = `/admin/posts/${post.id}?from=scheduled`;
  const dayText = dayLabel(slot.day, todayKey);
  const slotText = slot.hour != null ? formatSlotHour(slot.hour) : null;

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

  const isPublished = kind === "published";
  const showSchedule = kind === "proposed";
  const showRemove = !isPublished;

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm ring-1 ring-black/[0.02] transition-all hover:shadow-md md:gap-4 md:p-4 ${
        isPublished ? "border-gray-100 opacity-60" : "border-gray-100 hover:border-gray-200"
      }`}
    >
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 md:gap-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-20 md:w-20">
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
        </div>

        <div className="min-w-0 flex-1">
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
            {platforms.length > 0 && (
              <span className="flex items-center gap-1">
                {platforms.map((p) => {
                  const meta = PLATFORM_META[p];
                  if (!meta) return null;
                  return <meta.Icon key={p} className={`h-3.5 w-3.5 shrink-0 ${meta.color}`} />;
                })}
              </span>
            )}
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
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{displayBody(post.body)}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
        </div>
      </Link>

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
        {showRemove && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
