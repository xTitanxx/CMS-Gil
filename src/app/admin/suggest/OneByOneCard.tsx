"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Check,
  X,
  CalendarClock,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  Bell,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { formatSlotHour } from "@/lib/planner/format-slot";
import type { SuggestCandidate, SuggestedSlot } from "./types";

interface Props {
  candidate: SuggestCandidate;
  initialSlot: SuggestedSlot;
  initialPlatforms: string[];
  onSkip: () => void;
  onAccept: (input: { body: string; platforms: string[]; slot: SuggestedSlot }) => Promise<void>;
}

const PUBLISHABLE_PLATFORMS = [
  { key: "FACEBOOK_PAGE", label: "FB Page", Icon: SiFacebook, color: "text-[#1877F2]", requiresVideo: false },
  { key: "INSTAGRAM", label: "Instagram", Icon: SiInstagram, color: "text-[#E1306C]", requiresVideo: false },
  { key: "LINKEDIN", label: "LinkedIn", Icon: FaLinkedin, color: "text-[#0A66C2]", requiresVideo: false },
  { key: "YOUTUBE", label: "YouTube", Icon: SiYoutube, color: "text-[#FF0000]", requiresVideo: true },
  { key: "TIKTOK", label: "TikTok", Icon: SiTiktok, color: "text-[#111111]", requiresVideo: true },
] as const;

function formatSlotParts(day: string, hour: number): { when: string; weekday: string; date: string; time: string } {
  const d = new Date(day + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const time = formatSlotHour(hour);
  const when = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : weekday;
  return { when, weekday, date, time };
}

function formatScheduleLabel(day: string, hour: number): string {
  const { when, date, time } = formatSlotParts(day, hour);
  const dateLabel = when === "Today" || when === "Tomorrow" ? when : `${when} ${date}`;
  return `${dateLabel} · ${time}`;
}

const SWIPE_THRESHOLD_RATIO = 0.35;
const MAX_ROTATION_DEG = 6;

export function OneByOneCard({ candidate, initialSlot, initialPlatforms, onSkip, onAccept }: Props) {
  const [body, setBody] = useState(candidate.body);
  const [editing, setEditing] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(initialPlatforms);
  const [reminderFb, setReminderFb] = useState(true);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [muted, setMuted] = useState(true);
  const [rewriting, setRewriting] = useState(false);
  const [drag, setDrag] = useState({ x: 0, active: false });
  const [exitDir, setExitDir] = useState<"left" | "right" | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const captureRef = useRef<{ pointerId: number } | null>(null);

  useEffect(() => {
    setBody(candidate.body);
    setEditing(false);
    setPlatforms(initialPlatforms);
    setReminderFb(true);
    setMediaIdx(0);
    setAccepted(false);
    setMuted(true);
    setDrag({ x: 0, active: false });
    setExitDir(null);
  }, [candidate.id, candidate.body, initialPlatforms]);

  const media = candidate.media[mediaIdx] ?? null;
  const isVideo = media?.mimeType.startsWith("video/") ?? false;
  const hasMultipleMedia = candidate.media.length > 1;
  const candidateHasVideo = candidate.hasVideo === true;

  const togglePlatform = (key: string, requiresVideo: boolean) => {
    if (requiresVideo && !candidateHasVideo) return;
    setPlatforms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  };

  const fireAccept = async () => {
    if (accepting || accepted) return;
    setAccepting(true);
    setAccepted(true);
    setExitDir("right");
    await new Promise((r) => setTimeout(r, 280));
    try {
      await onAccept({ body, platforms, slot: initialSlot });
    } catch {
      setAccepted(false);
      setExitDir(null);
    } finally {
      setAccepting(false);
    }
  };

  const fireSkip = async () => {
    if (accepting || accepted) return;
    setExitDir("left");
    await new Promise((r) => setTimeout(r, 220));
    onSkip();
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (accepting || accepted) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Don't hijack mouse drags on desktop — swipe is a mobile/touch affordance.
    if (e.pointerType === "mouse") return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    captureRef.current = { pointerId: e.pointerId };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    setDrag({ x: 0, active: true });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12 && Math.abs(dx) < 12) {
      dragStartRef.current = null;
      setDrag({ x: 0, active: false });
      return;
    }
    setDrag({ x: dx, active: true });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) {
      setDrag({ x: 0, active: false });
      return;
    }
    const dx = e.clientX - dragStartRef.current.x;
    dragStartRef.current = null;
    if (captureRef.current) {
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(captureRef.current.pointerId);
      } catch {
        // pointer may already be released
      }
      captureRef.current = null;
    }

    const w = cardRef.current?.clientWidth ?? 320;
    const threshold = w * SWIPE_THRESHOLD_RATIO;
    if (dx > threshold && platforms.length > 0) {
      setDrag({ x: 0, active: false });
      void fireAccept();
      return;
    }
    if (dx < -threshold) {
      setDrag({ x: 0, active: false });
      void fireSkip();
      return;
    }
    setDrag({ x: 0, active: false });
  };

  const handleRewrite = async () => {
    if (rewriting) return;
    setRewriting(true);
    try {
      const res = await fetch(`/api/posts/${candidate.id}/caption-suggestion/generate`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      const suggestion: string | undefined = data?.suggestion;
      if (typeof suggestion === "string" && suggestion.trim().length > 0) {
        setBody(suggestion);
      }
    } finally {
      setRewriting(false);
    }
  };

  const w = cardRef.current?.clientWidth ?? 320;
  const dragX = drag.active ? drag.x : 0;
  const exitX = exitDir === "right" ? w * 1.4 : exitDir === "left" ? -w * 1.4 : 0;
  const tx = drag.active ? dragX : exitX;
  const rot = drag.active
    ? Math.max(-MAX_ROTATION_DEG, Math.min(MAX_ROTATION_DEG, (dragX / w) * MAX_ROTATION_DEG * 2))
    : exitDir
      ? exitDir === "right"
        ? MAX_ROTATION_DEG
        : -MAX_ROTATION_DEG
      : 0;
  const opacity = exitDir ? 0 : 1;
  const swipeHint = drag.active
    ? dragX > 40
      ? "right"
      : dragX < -40
        ? "left"
        : null
    : null;

  const slotParts = formatSlotParts(initialSlot.day, initialSlot.hour);
  const scheduleLabel = formatScheduleLabel(initialSlot.day, initialSlot.hour);

  // Slot pill — the centerpiece. Shown above the action bar so it's visible
  // whether the user is on mobile (vertical stack) or desktop (split column).
  const SlotPill = (
    <div className="rounded-2xl border border-purple-200 bg-gradient-to-br from-purple-50 via-white to-purple-50 p-4 shadow-sm md:p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm md:h-12 md:w-12">
          <CalendarClock className="h-5 w-5 md:h-6 md:w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
            Filling slot
          </div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-lg font-bold leading-tight text-gray-900 md:text-xl">
              {slotParts.when}
            </span>
            {slotParts.when !== "Today" && slotParts.when !== "Tomorrow" && (
              <span className="text-sm font-medium text-gray-500 md:text-base">
                {slotParts.date}
              </span>
            )}
            <span className="text-lg font-bold leading-tight text-purple-700 md:text-xl">
              · {slotParts.time}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  const CaptionBlock = (
    <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-4">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Caption</span>
        <button
          onClick={handleRewrite}
          disabled={rewriting}
          className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-purple-200 hover:bg-purple-100 disabled:opacity-60"
        >
          {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {rewriting ? "Rewriting…" : "Rewrite"}
        </button>
      </div>
      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => setEditing(false)}
          autoFocus
          className="w-full resize-y rounded-md border border-gray-200 bg-gray-50 p-2 text-base leading-snug focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 min-h-[150px] md:min-h-[200px]"
          rows={8}
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="min-h-[80px] cursor-text whitespace-pre-wrap rounded-md p-1 text-base leading-snug text-gray-800 hover:bg-gray-50 md:min-h-[120px]"
        >
          {body || <span className="italic text-gray-400">Tap to add a caption…</span>}
        </p>
      )}
    </div>
  );

  const PlatformsBlock = (
    <div className="rounded-xl border border-gray-200 bg-white p-3 md:p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        Publish to
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PUBLISHABLE_PLATFORMS.map(({ key, label, Icon, color, requiresVideo }) => {
          const active = platforms.includes(key);
          const disabled = requiresVideo && !candidateHasVideo;
          return (
            <button
              key={key}
              onClick={() => togglePlatform(key, requiresVideo)}
              disabled={disabled}
              title={disabled ? "Video posts only" : undefined}
              aria-disabled={disabled}
              className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                disabled
                  ? "cursor-not-allowed border-gray-100 bg-gray-50 text-gray-300"
                  : active
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
              }`}
            >
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${
                  disabled ? "text-gray-300" : active ? "text-white" : color
                }`}
              />
              <span className="truncate">{label}</span>
              {disabled && <span className="text-[10px] uppercase opacity-70">video</span>}
            </button>
          );
        })}
      </div>
      <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">
        <input
          type="checkbox"
          checked={reminderFb}
          onChange={(e) => setReminderFb(e.target.checked)}
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
  );

  const MediaFrame = (
    <div
      className="relative shrink-0 overflow-hidden rounded-2xl bg-black shadow-lg select-none touch-pan-y"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {media?.url ? (
        isVideo ? (
          <video
            key={media.id}
            src={media.url}
            muted={muted}
            playsInline
            autoPlay
            loop
            className="block w-full h-auto pointer-events-none"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt=""
            draggable={false}
            className="block w-full h-auto pointer-events-none"
          />
        )
      ) : (
        <div className="flex h-48 w-full items-center justify-center text-gray-500">
          <span className="text-xs">No media</span>
        </div>
      )}

      {hasMultipleMedia && (
        <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
          {candidate.media.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === mediaIdx ? "w-5 bg-white" : "w-1.5 bg-white/50"}`}
            />
          ))}
        </div>
      )}

      {hasMultipleMedia && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMediaIdx((i) => (i === 0 ? candidate.media.length - 1 : i - 1));
            }}
            className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMediaIdx((i) => (i + 1) % candidate.media.length);
            }}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}

      {isVideo && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMuted((m) => !m);
          }}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      )}

      <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
        {candidate.publishCount > 0
          ? `Reposted ${candidate.publishCount}×`
          : `From ${candidate.originalDate.slice(0, 10)}`}
      </div>

      {swipeHint === "right" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-start pl-6">
          <div className="rounded-2xl bg-emerald-500/85 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-lg ring-2 ring-white">
            Schedule
          </div>
        </div>
      )}
      {swipeHint === "left" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-end pr-6">
          <div className="rounded-2xl bg-rose-500/85 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white shadow-lg ring-2 ring-white">
            Skip
          </div>
        </div>
      )}

      {accepted && exitDir === "right" && (
        <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/85 backdrop-blur-sm">
          <div className="animate-[ping_400ms_ease-out] rounded-full bg-white p-4">
            <Check className="h-10 w-10 text-emerald-600" strokeWidth={3} />
          </div>
        </div>
      )}
    </div>
  );

  const ActionBar = (
    <div
      className="sticky bottom-0 mt-auto flex shrink-0 items-stretch gap-2 border-t border-gray-200 bg-white/95 px-3 py-2 backdrop-blur md:px-6 md:py-3"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
    >
      <button
        onClick={() => void fireSkip()}
        disabled={accepting || accepted}
        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 md:py-3.5 md:text-base"
      >
        <X className="h-4 w-4 md:h-5 md:w-5" />
        Skip
      </button>
      <button
        onClick={() => void fireAccept()}
        disabled={accepting || accepted || platforms.length === 0}
        className="flex min-w-0 flex-[2] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50 md:py-3.5 md:text-base"
      >
        {accepting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0 md:h-5 md:w-5" strokeWidth={2.5} />}
        <span className="truncate">
          {accepted ? "Scheduled!" : `Schedule ${scheduleLabel}`}
        </span>
      </button>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={cardRef}
        className="mx-auto flex w-full max-w-md flex-1 min-h-0 flex-col overflow-y-auto px-3 py-3 md:max-w-6xl md:px-6 md:py-6"
        style={{
          transform: `translateX(${tx}px) rotate(${rot}deg)`,
          opacity,
          transition: drag.active ? "none" : "transform 280ms ease-out, opacity 220ms ease-out",
          willChange: "transform, opacity",
        }}
      >
        {/* Mobile: single column. Desktop: media left, details right. */}
        <div className="flex flex-col gap-3 md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
          <div className="flex min-w-0 flex-col gap-3 md:gap-4">
            {MediaFrame}
            {/* Mobile-only slot pill — sits right under media so it's near the
                Schedule button visually. Desktop renders it in the right column. */}
            <div className="md:hidden">{SlotPill}</div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 md:gap-4">
            {/* Desktop-only slot pill */}
            <div className="hidden md:block">{SlotPill}</div>
            {CaptionBlock}
            {PlatformsBlock}
          </div>
        </div>
      </div>

      {ActionBar}
    </div>
  );
}
