"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  CalendarClock,
  Check,
  Copy,
  Download,
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
  /** Caption — used by the FB Personal "Copy" button. */
  body: string;
  /** Post media — drives platform eligibility AND powers the Download button. */
  media: SchedulePanelMedia[];
  /** Called after a successful schedule/publish so the parent can refresh. */
  onChanged?: () => void;
}

const PUBLISHABLE_PLATFORMS = [
  {
    key: "FACEBOOK_PAGE",
    label: "FB Page",
    Icon: SiFacebook,
    color: "text-[#1877F2]",
    activeClasses: "border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]",
  },
  {
    key: "INSTAGRAM",
    label: "Instagram",
    Icon: SiInstagram,
    color: "text-[#E1306C]",
    activeClasses: "border-[#E1306C] bg-[#E1306C]/10 text-[#E1306C]",
  },
  {
    key: "LINKEDIN",
    label: "LinkedIn",
    Icon: FaLinkedin,
    color: "text-[#0A66C2]",
    activeClasses: "border-[#0A66C2] bg-[#0A66C2]/10 text-[#0A66C2]",
  },
  {
    key: "YOUTUBE",
    label: "YouTube",
    Icon: SiYoutube,
    color: "text-[#FF0000]",
    activeClasses: "border-[#FF0000] bg-[#FF0000]/10 text-[#FF0000]",
  },
  {
    key: "TIKTOK",
    label: "TikTok",
    Icon: SiTiktok,
    color: "text-[#111111]",
    activeClasses: "border-gray-900 bg-gray-900 text-white",
  },
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

function extFromMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/gif") return "gif";
  if (m === "image/webp") return "webp";
  if (m === "image/heic") return "heic";
  if (m === "video/mp4") return "mp4";
  if (m === "video/quicktime") return "mov";
  if (m === "video/webm") return "webm";
  if (m.startsWith("image/")) return "img";
  if (m.startsWith("video/")) return "mp4";
  return "bin";
}

export function SchedulePanel({ postId, body, media, onChanged }: SchedulePanelProps) {
  const shape = useMemo(
    () => mediaShapeFromMimeTypes(media.map((m) => m.mimeType)),
    [media],
  );
  const eligible = useMemo(
    () => eligiblePlatforms(shape, PUBLISHABLE_PLATFORMS.map((p) => p.key)),
    [shape],
  );
  const eligibilityKey = eligible.join(",");

  const [slot, setSlot] = useState<SlotShape | null>(null);
  const [platforms, setPlatforms] = useState<string[]>(eligible);
  const [reminderFb, setReminderFb] = useState(true);
  const [loadingSlot, setLoadingSlot] = useState(true);
  const [slotError, setSlotError] = useState<string | null>(null);

  // Action state — schedule / postNow share this so two actions can't fire
  // simultaneously.
  const [busy, setBusy] = useState<null | "schedule" | "post">(null);
  const [scheduled, setScheduled] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSlot = useCallback(async (opts?: { silent?: boolean }) => {
    // `silent` skips the loading spinner — used by auto-refresh + visibility
    // handlers so the SlotPill doesn't flicker every minute.
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

  // Auto-refresh the slot so it stays current as time passes and as other
  // posts get scheduled into nearby hours. Pauses once the user has scheduled
  // (the panel collapses into a confirmation), skips while busy to avoid
  // racing an in-flight schedule/publish, and skips when the tab is hidden so
  // backgrounded tabs don't hammer the API. A visibilitychange listener fires
  // a refetch the moment the tab comes back to the foreground.
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

  // Re-sync the platform selection whenever eligibility changes (e.g. user
  // adds/removes media). Default = every eligible platform; keyed on the
  // joined list for stable, content-based comparison.
  useEffect(() => {
    setPlatforms(eligible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityKey]);

  const togglePlatform = (key: string) => {
    if (!isPlatformEligible(key, shape)) return;
    setPlatforms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  };

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
      onChanged?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Schedule failed");
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (busy) return;
    if (platforms.length === 0) {
      setActionError("Select at least one platform");
      return;
    }
    setBusy("post");
    setActionError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Publish failed (${res.status})`);
      }
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

  const copyCaption = async () => {
    if (!body) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      setCopyError("Copy not supported in this browser");
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setCopyError("");
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError("Copy failed — try again");
    }
  };

  const downloadMedia = async () => {
    const downloadable = media.filter((m): m is SchedulePanelMedia & { url: string } => !!m.url);
    if (downloadable.length === 0) return;
    setDownloading(true);
    setDownloadError("");
    try {
      for (let i = 0; i < downloadable.length; i++) {
        const m = downloadable[i];
        const res = await fetch(`/api/media/${m.id}/download`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `post-${postId}-${i + 1}.${extFromMime(m.mimeType)}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const downloadableCount = media.filter((m) => m.url).length;
  const canSchedule = slot != null && !scheduled;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Publish</h3>
        {canSchedule && !loadingSlot && (
          <button
            type="button"
            onClick={() => void fetchSlot()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            title="Find another slot"
          >
            <RotateCw className="h-3 w-3" />
            Refresh slot
          </button>
        )}
      </div>

      <div className="space-y-3 px-4 pb-4">
        {loadingSlot && (
          <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding the next open slot…
          </div>
        )}

        {!loadingSlot && !slot && (
          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-3 text-xs text-amber-900">
            {slotError ?? "No open slots in the next 8 weeks — Post Now still works."}
          </div>
        )}

        {!loadingSlot && slot && <SlotPill slot={slot} />}

        {/* Platform chips — drive Schedule, Post Now, and (implicitly via
            the all-eligible set) Post All. */}
        <div className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Publish to
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PUBLISHABLE_PLATFORMS.map(({ key, label, Icon, color, activeClasses }) => {
              const active = platforms.includes(key);
              const reason = ineligibilityReason(key, shape);
              const disabled = reason !== null || scheduled;
              const iconColor = reason
                ? "text-gray-300"
                : active
                  ? key === "TIKTOK"
                    ? "text-white"
                    : color
                  : color;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => togglePlatform(key)}
                  disabled={disabled}
                  title={reason ?? undefined}
                  aria-disabled={disabled}
                  className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    reason
                      ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                      : active
                        ? activeClasses
                        : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  } ${scheduled ? "opacity-60" : ""}`}
                >
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
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

        {actionError && <p className="text-xs text-red-600">{actionError}</p>}

        {scheduled && slot ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200">
            <Check className="h-4 w-4 shrink-0" strokeWidth={3} />
            <span className="min-w-0 flex-1 truncate">
              Scheduled · {formatScheduleLabel(slot.day, slot.hour)}
            </span>
            <button
              type="button"
              onClick={resetForAnother}
              className="shrink-0 rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
            >
              Schedule another
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            {canSchedule && slot && (
              <button
                type="button"
                onClick={() => void scheduleSlot()}
                disabled={busy !== null || platforms.length === 0}
                className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
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
              disabled={busy !== null || platforms.length === 0}
              className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50 sm:flex-1"
            >
              {busy === "post" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Send className="h-4 w-4 shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {busy === "post" ? "Posting…" : `Post Now${platforms.length > 0 ? ` (${platforms.length})` : ""}`}
              </span>
            </button>
          </div>
        )}

        {/* Facebook Personal (manual) — copy caption + download media. */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-blue-700">
            <SiFacebook size={14} aria-hidden="true" className="shrink-0" />
            <span className="font-medium">FB Personal</span>
            <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gray-500">
              Manual
            </span>
            <span className="group relative">
              <button
                type="button"
                aria-label="Why manual?"
                className="inline-flex h-4 w-4 items-center justify-center text-gray-400 hover:text-gray-600"
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 top-full z-10 mt-1.5 w-56 -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              >
                Meta&apos;s API doesn&apos;t support personal profile posting. Copy caption + download media to post manually.
              </span>
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={copyCaption}
              disabled={!body}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
            <button
              type="button"
              onClick={downloadMedia}
              disabled={downloading || downloadableCount === 0}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {downloading ? "…" : "Media"}
            </button>
          </div>
        </div>
        {copyError && <p className="text-[11px] text-red-600">{copyError}</p>}
        {downloadError && <p className="text-[11px] text-red-600">Download: {downloadError}</p>}
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
            Next open slot
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
