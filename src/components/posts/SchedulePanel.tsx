"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  HelpCircle,
  Loader2,
  RotateCw,
  Send,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { formatSlotHour } from "@/lib/planner/format-slot";
import {
  eligiblePlatforms,
  ineligibilityReason,
  isPlatformEligible,
  mediaShapeFromMimeTypes,
} from "@/lib/platform-eligibility";
import { notifyPublishRecordCreated } from "@/lib/publish-events";

interface SlotShape {
  day: string;
  hour: number;
}

export interface SchedulePanelMedia {
  id: string;
  url: string | null;
  mimeType: string;
}

interface SchedulePanelProps {
  postId: string;
  /** Caption — kept on the prop type to avoid breaking parent call sites. */
  body: string;
  /** Post media — drives platform eligibility. */
  media: SchedulePanelMedia[];
  /** Called after a successful schedule/publish so the parent can refresh. */
  onChanged?: () => void;
}

// FB Personal is a UI-only platform — manual posting can't go through the
// auto-publish path. We include it in the schedule payload (so a future
// queue-gate can opt-out on it) but always strip it before calling
// /api/posts/[id]/publish (which only knows about real auto platforms).
const FB_PERSONAL = "FACEBOOK_PERSONAL";

type ChipDef = {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  activeClasses: string;
  manual?: boolean;
};

const AUTO_PLATFORMS: ChipDef[] = [
  {
    key: "FACEBOOK_PAGE",
    label: "FB Page",
    Icon: SiFacebook,
    iconColor: "text-[#1877F2]",
    activeClasses: "border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]",
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    Icon: SiInstagram,
    iconColor: "text-[#E1306C]",
    activeClasses: "border-[#E1306C] bg-[#E1306C]/10 text-[#E1306C]",
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn",
    Icon: FaLinkedin,
    iconColor: "text-[#0A66C2]",
    activeClasses: "border-[#0A66C2] bg-[#0A66C2]/10 text-[#0A66C2]",
  },
  {
    key: "YOUTUBE",
    label: "YouTube",
    Icon: SiYoutube,
    iconColor: "text-[#FF0000]",
    activeClasses: "border-[#FF0000] bg-[#FF0000]/10 text-[#FF0000]",
  },
  {
    key: "TIKTOK",
    label: "TikTok",
    Icon: SiTiktok,
    iconColor: "text-[#111111]",
    activeClasses: "border-gray-900 bg-gray-100 text-gray-900",
  },
];

// Distinguished from FB Page via dashed border + lighter tint + Manual tag
// so the user can see at a glance that this one needs a human in the loop.
const FB_PERSONAL_CHIP: ChipDef = {
  key: FB_PERSONAL,
  label: "FB Personal",
  Icon: SiFacebook,
  iconColor: "text-[#1877F2]",
  activeClasses:
    "border-dashed border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]",
  manual: true,
};

const ALL_CHIPS: ChipDef[] = [...AUTO_PLATFORMS, FB_PERSONAL_CHIP];

function formatSlotParts(day: string, hour: number): { when: string; date: string; time: string } {
  const d = new Date(day + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = formatSlotHour(hour);
  const when = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : weekday;
  return { when, date, time };
}

function formatScheduleLabel(day: string, hour: number): string {
  const { when, date, time } = formatSlotParts(day, hour);
  const head = when === "Today" || when === "Tomorrow" ? when : `${when} ${date}`;
  return `${head} · ${time}`;
}

export function SchedulePanel({ postId, media, onChanged }: SchedulePanelProps) {
  const shape = useMemo(
    () => mediaShapeFromMimeTypes(media.map((m) => m.mimeType)),
    [media],
  );
  const eligibleAuto = useMemo(
    () => eligiblePlatforms(shape, AUTO_PLATFORMS.map((p) => p.key)),
    [shape],
  );
  const eligibilityKey = eligibleAuto.join(",");

  const [slot, setSlot] = useState<SlotShape | null>(null);
  // Default selection: every eligible auto platform + FB Personal (opt-out
  // model — the user removes it on the posts they don't want to cross-post).
  const [platforms, setPlatforms] = useState<string[]>(() => [...eligibleAuto, FB_PERSONAL]);
  const [loadingSlot, setLoadingSlot] = useState(true);
  const [slotError, setSlotError] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | "schedule" | "post">(null);
  const [scheduled, setScheduled] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSlot = useCallback(async (opts?: { silent?: boolean }) => {
    // `silent` skips the loading spinner — used by auto-refresh + visibility
    // handlers so the SlotRow doesn't flicker every minute.
    if (!opts?.silent) setLoadingSlot(true);
    setSlotError(null);
    setActionError(null);
    try {
      const res = await fetch(`/api/planner/next-slot?postId=${encodeURIComponent(postId)}`);
      if (!res.ok) throw new Error(`next-slot ${res.status}`);
      const data = (await res.json()) as {
        slot: SlotShape | null;
        platforms: string[];
        error?: string;
      };
      if (!data.slot) {
        setSlot(null);
        setSlotError(data.error ?? "No open slots in the next 8 weeks");
      } else {
        setSlot(data.slot);
      }
    } catch (e) {
      setSlot(null);
      setSlotError(e instanceof Error ? e.message : "Failed to load slot");
    } finally {
      setLoadingSlot(false);
    }
  }, [postId]);

  useEffect(() => {
    void fetchSlot();
  }, [fetchSlot]);

  useEffect(() => {
    if (scheduled) return;
    const maybeRefetch = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (busy) return;
      void fetchSlot({ silent: true });
    };
    const intervalId = window.setInterval(maybeRefetch, 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") maybeRefetch();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [scheduled, busy, fetchSlot]);

  // Re-sync platform selection when media eligibility changes:
  //   - drop any newly-ineligible auto platform
  //   - add freshly-eligible ones (e.g. uploaded a video → unlock YouTube)
  //   - leave FB Personal (manual) untouched so the user's opt-out persists
  useEffect(() => {
    setPlatforms((prev) => {
      const kept = prev.filter(
        (p) => p === FB_PERSONAL || eligibleAuto.includes(p),
      );
      const fresh = eligibleAuto.filter((p) => !kept.includes(p));
      return [...kept, ...fresh];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityKey]);

  const togglePlatform = (key: string) => {
    if (key !== FB_PERSONAL && !isPlatformEligible(key, shape)) return;
    setPlatforms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  };

  // Auto platforms only — used for Post Now (manual platforms can't auto-publish).
  const autoSelected = platforms.filter((p) => p !== FB_PERSONAL);
  const hasFbPersonal = platforms.includes(FB_PERSONAL);
  const canScheduleSlot = slot != null && !scheduled;
  const canSchedule = canScheduleSlot && platforms.length > 0 && busy === null;
  const canPostNow = autoSelected.length > 0 && busy === null;

  const scheduleSlot = async () => {
    if (!slot || busy || scheduled || platforms.length === 0) return;
    setBusy("schedule");
    setActionError(null);
    try {
      const res = await fetch("/api/planner/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          day: slot.day,
          hour: slot.hour,
          platforms,
          reasoning: "Scheduled from post page",
          schedule: true,
        }),
      });
      if (res.status === 409) {
        setActionError("That slot was just taken — refreshing.");
        setBusy(null);
        void fetchSlot();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Schedule failed (${res.status})`);
      }
      setScheduled(true);
      notifyPublishRecordCreated(postId);
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Schedule failed");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (busy) return;
    if (autoSelected.length === 0) {
      setActionError("Pick at least one auto-publish platform");
      return;
    }
    setBusy("post");
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: autoSelected }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Publish failed (${res.status})`);
      }
      notifyPublishRecordCreated(postId);
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setBusy(null);
    }
  };

  const resetForAnother = () => {
    setScheduled(false);
    setActionError(null);
    void fetchSlot();
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <SlotRow
        slot={slot}
        loading={loadingSlot}
        error={slotError}
        onRefresh={() => void fetchSlot()}
        disabled={scheduled || busy !== null}
      />

      <div className="space-y-3 px-3 py-3 sm:px-4">
        <div className="flex flex-wrap gap-1.5">
          {ALL_CHIPS.map((chip) => {
            const active = platforms.includes(chip.key);
            const reason = chip.manual
              ? null
              : ineligibilityReason(chip.key, shape);
            const disabled = reason !== null || scheduled || busy !== null;
            const iconColor = chip.iconColor;
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => togglePlatform(chip.key)}
                disabled={disabled}
                title={
                  reason ??
                  (chip.manual
                    ? "Manual — get a push reminder to post yourself"
                    : undefined)
                }
                aria-pressed={active}
                aria-disabled={disabled}
                className={`group inline-flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all ${
                  reason
                    ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                    : active
                      ? chip.activeClasses
                      : chip.manual
                        ? "border-dashed border-gray-300 bg-white text-gray-600 hover:border-[#1877F2]/40 hover:bg-[#1877F2]/5 hover:text-[#1877F2]"
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                } ${scheduled ? "opacity-60" : ""}`}
              >
                <chip.Icon
                  className={`h-3.5 w-3.5 shrink-0 ${reason ? "text-gray-300" : iconColor}`}
                />
                <span className="truncate">{chip.label}</span>
                {chip.manual && (
                  <span
                    className={`shrink-0 rounded-sm px-1 py-px text-[8px] font-bold uppercase tracking-wider ${
                      active
                        ? "bg-[#1877F2]/15 text-[#1877F2]"
                        : "bg-gray-100 text-gray-400 group-hover:bg-[#1877F2]/10 group-hover:text-[#1877F2]"
                    }`}
                  >
                    Manual
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {hasFbPersonal && !scheduled && (
          <div className="flex items-start gap-1.5 text-[11px] text-gray-500">
            <HelpCircle className="mt-0.5 h-3 w-3 shrink-0 text-gray-400" />
            <span className="min-w-0 break-words">
              FB Personal posts manually — you&apos;ll get a push reminder 15 minutes before the slot.
            </span>
          </div>
        )}

        {actionError && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-100 break-words">
            {actionError}
          </div>
        )}

        {scheduled && slot ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-200">
            <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
            <span className="min-w-0 flex-1 truncate font-medium">
              Scheduled · {formatScheduleLabel(slot.day, slot.hour)}
            </span>
            <button
              type="button"
              onClick={resetForAnother}
              className="shrink-0 rounded-md bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100"
            >
              Schedule another
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            {canScheduleSlot && slot && (
              <button
                type="button"
                onClick={() => void scheduleSlot()}
                disabled={!canSchedule}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"
              >
                {busy === "schedule" ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <CalendarClock className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                )}
                <span className="min-w-0 truncate">
                  {busy === "schedule"
                    ? "Scheduling…"
                    : `Schedule ${formatScheduleLabel(slot.day, slot.hour)}`}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void publish()}
              disabled={!canPostNow}
              title={
                autoSelected.length === 0
                  ? "Select an auto-publish platform to post now"
                  : undefined
              }
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 sm:flex-1"
            >
              {busy === "post" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Send className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {busy === "post"
                  ? "Posting…"
                  : `Post now${autoSelected.length > 0 ? ` (${autoSelected.length})` : ""}`}
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SlotRow({
  slot,
  loading,
  error,
  onRefresh,
  disabled,
}: {
  slot: SlotShape | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  disabled: boolean;
}) {
  const parts = slot ? formatSlotParts(slot.day, slot.hour) : null;
  return (
    <div className="flex items-center gap-2 border-b border-gray-100 bg-gradient-to-r from-purple-50/60 via-white to-white px-3 py-2 sm:px-4">
      <CalendarClock className="h-4 w-4 shrink-0 text-purple-600" />
      <div className="min-w-0 flex-1">
        {loading ? (
          <div className="flex items-center gap-1.5 text-[12px] text-gray-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            Finding next slot…
          </div>
        ) : parts ? (
          <div className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-700">
              Next
            </span>
            <span className="font-semibold text-gray-900">{parts.when}</span>
            {parts.when !== "Today" && parts.when !== "Tomorrow" && (
              <span className="text-gray-500">{parts.date}</span>
            )}
            <span className="font-semibold text-purple-700">· {parts.time}</span>
          </div>
        ) : (
          <div className="text-[12px] text-amber-700">
            {error ?? "No open slots — Post Now still works"}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled || loading}
        aria-label="Find another slot"
        title="Find another slot"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-white hover:text-gray-700 disabled:opacity-40"
      >
        <RotateCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
