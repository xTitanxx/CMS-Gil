"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, Check, Loader2, RotateCw } from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { formatSlotHour } from "@/lib/planner/format-slot";
import {
  eligiblePlatforms,
  ineligibilityReason,
  isPlatformEligible,
  mediaShapeFromMimeTypes,
} from "@/lib/platform-eligibility";

interface SlotShape {
  day: string;
  hour: number;
}

interface SchedulePanelProps {
  postId: string;
  /** MIME types of the post's media — drives platform eligibility. */
  mediaMimeTypes: string[];
  /** Called after a successful schedule so the parent can refresh activity. */
  onScheduled?: () => void;
}

const PUBLISHABLE_PLATFORMS = [
  { key: "FACEBOOK_PAGE", label: "FB Page", Icon: SiFacebook, color: "text-[#1877F2]" },
  { key: "INSTAGRAM", label: "Instagram", Icon: SiInstagram, color: "text-[#E1306C]" },
  { key: "LINKEDIN", label: "LinkedIn", Icon: FaLinkedin, color: "text-[#0A66C2]" },
  { key: "YOUTUBE", label: "YouTube", Icon: SiYoutube, color: "text-[#FF0000]" },
  { key: "TIKTOK", label: "TikTok", Icon: SiTiktok, color: "text-[#111111]" },
] as const;

function formatSlotParts(day: string, hour: number): { when: string; date: string; time: string } {
  const d = new Date(day + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = formatSlotHour(hour);
  const when = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : weekday;
  return { when, date, time };
}

function formatScheduleLabel(day: string, hour: number): string {
  const { when, date, time } = formatSlotParts(day, hour);
  const dateLabel = when === "Today" || when === "Tomorrow" ? when : `${when} ${date}`;
  return `${dateLabel} · ${time}`;
}

export function SchedulePanel({ postId, mediaMimeTypes, onScheduled }: SchedulePanelProps) {
  const shape = useMemo(() => mediaShapeFromMimeTypes(mediaMimeTypes), [mediaMimeTypes]);
  const eligible = useMemo(
    () => eligiblePlatforms(shape, PUBLISHABLE_PLATFORMS.map((p) => p.key)),
    [shape],
  );

  const [slot, setSlot] = useState<SlotShape | null>(null);
  const [platforms, setPlatforms] = useState<string[]>(eligible);
  const [reminderFb, setReminderFb] = useState(true);
  const [loadingSlot, setLoadingSlot] = useState(true);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const fetchSlot = useCallback(async () => {
    setLoadingSlot(true);
    setSlotError(null);
    setScheduleError(null);
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
        // Server-provided platforms factor in connections; intersect with the
        // media-eligible set so the chips can't disagree with the UI rules.
        const serverEligible = data.platforms.filter((p) => eligible.includes(p));
        setPlatforms(serverEligible.length > 0 ? serverEligible : eligible);
      }
    } catch (e) {
      setSlot(null);
      setSlotError(e instanceof Error ? e.message : "Failed to load slot");
    } finally {
      setLoadingSlot(false);
    }
  }, [postId, eligible]);

  useEffect(() => {
    void fetchSlot();
  }, [fetchSlot]);

  const togglePlatform = (key: string) => {
    if (!isPlatformEligible(key, shape)) return;
    setPlatforms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  };

  const submit = async () => {
    if (!slot || scheduling || scheduled || platforms.length === 0) return;
    setScheduling(true);
    setScheduleError(null);
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
        setScheduleError("That slot was just taken — refreshing.");
        setScheduling(false);
        void fetchSlot();
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = err?.error ?? `Schedule failed (${res.status})`;
        throw new Error(message);
      }
      setScheduled(true);
      onScheduled?.();
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Schedule failed");
    } finally {
      setScheduling(false);
    }
  };

  const scheduleAnother = () => {
    setScheduled(false);
    setScheduleError(null);
    void fetchSlot();
  };

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Schedule next slot</h3>
        {!loadingSlot && slot && !scheduled && (
          <button
            type="button"
            onClick={() => void fetchSlot()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            title="Find another slot"
          >
            <RotateCw className="h-3 w-3" />
            Refresh
          </button>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4">
        {loadingSlot && (
          <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-4 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding the next open slot…
          </div>
        )}

        {!loadingSlot && !slot && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs text-amber-900">
            {slotError ?? "No open slots in the next 8 weeks."}
          </div>
        )}

        {!loadingSlot && slot && (
          <>
            <SlotPill slot={slot} />

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Publish to
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PUBLISHABLE_PLATFORMS.map(({ key, label, Icon, color }) => {
                  const active = platforms.includes(key);
                  const reason = ineligibilityReason(key, shape);
                  const disabled = reason !== null || scheduled;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePlatform(key)}
                      disabled={disabled}
                      title={reason ?? undefined}
                      aria-disabled={disabled}
                      className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                        disabled && reason
                          ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                          : active
                            ? "border-gray-900 bg-gray-900 text-white"
                            : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      } ${scheduled ? "opacity-60" : ""}`}
                    >
                      <Icon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          reason ? "text-gray-300" : active ? "text-white" : color
                        }`}
                      />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
              <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">
                <input
                  type="checkbox"
                  checked={reminderFb}
                  onChange={(e) => setReminderFb(e.target.checked)}
                  disabled={scheduled}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-300"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-semibold">
                    <Bell className="h-3 w-3 shrink-0" />
                    FB personal reminder
                  </span>
                  <span className="block text-[11px] text-amber-800">
                    Get a notification before this slot to manually post on Facebook personal.
                  </span>
                </span>
              </label>
            </div>

            {scheduleError && (
              <p className="text-xs text-red-600">{scheduleError}</p>
            )}

            {scheduled ? (
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
                <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
                <span className="min-w-0 flex-1 truncate">
                  Scheduled · {formatScheduleLabel(slot.day, slot.hour)}
                </span>
                <button
                  type="button"
                  onClick={scheduleAnother}
                  className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                >
                  Schedule another
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void submit()}
                disabled={scheduling || platforms.length === 0}
                className="flex w-full min-w-0 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {scheduling ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                )}
                <span className="min-w-0 truncate">
                  {scheduling
                    ? "Scheduling…"
                    : `Schedule ${formatScheduleLabel(slot.day, slot.hour)}`}
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SlotPill({ slot }: { slot: SlotShape }) {
  const parts = formatSlotParts(slot.day, slot.hour);
  return (
    <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-purple-50 p-3 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm">
          <CalendarClock className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
            Filling slot
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-base font-bold leading-tight text-gray-900 md:text-lg">
              {parts.when}
            </span>
            {parts.when !== "Today" && parts.when !== "Tomorrow" && (
              <span className="text-sm font-medium text-gray-500">{parts.date}</span>
            )}
            <span className="text-base font-bold leading-tight text-purple-700 md:text-lg">
              · {parts.time}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
