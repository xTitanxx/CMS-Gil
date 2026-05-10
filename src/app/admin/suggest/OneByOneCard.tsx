"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Pencil,
  Check,
  X,
  Calendar,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  Bell,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
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
  { key: "FACEBOOK_PAGE", label: "FB Page", Icon: SiFacebook, color: "text-[#1877F2]" },
  { key: "INSTAGRAM", label: "Instagram", Icon: SiInstagram, color: "text-[#E1306C]" },
  { key: "LINKEDIN", label: "LinkedIn", Icon: FaLinkedin, color: "text-[#0A66C2]" },
  { key: "YOUTUBE", label: "YouTube", Icon: SiYoutube, color: "text-[#FF0000]" },
  { key: "TIKTOK", label: "TikTok", Icon: SiTiktok, color: "text-[#111111]" },
] as const;

function dayLabel(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const weekday = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const md = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (diff === 0) return `Today · ${weekday}`;
  if (diff === 1) return `Tomorrow · ${weekday}`;
  return `${weekday} · ${md}`;
}

export function OneByOneCard({ candidate, initialSlot, initialPlatforms, onSkip, onAccept }: Props) {
  const [body, setBody] = useState(candidate.body);
  const [editing, setEditing] = useState(false);
  const [platforms, setPlatforms] = useState<string[]>(initialPlatforms);
  const [reminderFb, setReminderFb] = useState(true);
  const [slot, setSlot] = useState<SuggestedSlot>(initialSlot);
  const [mediaIdx, setMediaIdx] = useState(0);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [muted, setMuted] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  // Reset on candidate change
  useEffect(() => {
    setBody(candidate.body);
    setEditing(false);
    setPlatforms(initialPlatforms);
    setReminderFb(true);
    setSlot(initialSlot);
    setMediaIdx(0);
    setAccepted(false);
    setMuted(true);
  }, [candidate.id, candidate.body, initialPlatforms, initialSlot]);

  const media = candidate.media[mediaIdx] ?? null;
  const isVideo = media?.mimeType.startsWith("video/") ?? false;
  const hasMultipleMedia = candidate.media.length > 1;

  const togglePlatform = (key: string) => {
    setPlatforms((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  };

  const handleAccept = async () => {
    if (accepting || accepted) return;
    setAccepting(true);
    setAccepted(true);
    // Run the accept animation, then commit + advance after a short beat.
    await new Promise((r) => setTimeout(r, 350));
    try {
      await onAccept({ body, platforms, slot });
    } catch {
      setAccepted(false);
    } finally {
      setAccepting(false);
    }
  };

  // Generate a list of upcoming day options (next 14 days)
  const dayOptions = useMemo(() => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const out: string[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(today.getTime() + i * 86400000);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={cardRef}
        className={`mx-auto flex w-full max-w-md flex-1 min-h-0 flex-col px-3 py-3 transition-all duration-300 ${
          accepted ? "translate-y-[-12px] opacity-0 scale-95" : "translate-y-0 opacity-100 scale-100"
        }`}
      >
        {/* Media frame */}
        <div className="relative overflow-hidden rounded-2xl bg-black shadow-lg" style={{ aspectRatio: "4 / 5" }}>
          {media?.url ? (
            isVideo ? (
              <video
                key={media.id}
                src={media.url}
                muted={muted}
                playsInline
                autoPlay
                loop
                className="h-full w-full object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={media.url} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-500">
              <span className="text-xs">No media</span>
            </div>
          )}

          {/* Pager dots */}
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

          {/* Pager arrows on tap */}
          {hasMultipleMedia && (
            <>
              <button
                onClick={() => setMediaIdx((i) => (i === 0 ? candidate.media.length - 1 : i - 1))}
                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55"
                aria-label="Previous"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                onClick={() => setMediaIdx((i) => (i + 1) % candidate.media.length)}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/55"
                aria-label="Next"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          {/* Mute toggle for video */}
          {isVideo && (
            <button
              onClick={() => setMuted((m) => !m)}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          )}

          {/* Originally posted chip */}
          <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
            {candidate.publishCount > 0
              ? `Reposted ${candidate.publishCount}×`
              : `From ${candidate.originalDate.slice(0, 10)}`}
          </div>

          {accepted && (
            <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/85 backdrop-blur-sm">
              <div className="animate-[ping_400ms_ease-out] rounded-full bg-white p-4">
                <Check className="h-10 w-10 text-emerald-600" strokeWidth={3} />
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="mt-3 flex-1 min-h-0 overflow-y-auto rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Caption</span>
            <button
              onClick={() => setEditing((e) => !e)}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                editing ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              <Pencil className="h-3 w-3" />
              {editing ? "Done" : "Edit"}
            </button>
          </div>
          {editing ? (
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              autoFocus
              className="w-full resize-none rounded-md border border-gray-200 bg-gray-50 p-2 text-[14px] leading-snug focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100"
              rows={6}
            />
          ) : (
            <p className="whitespace-pre-wrap text-[14px] leading-snug text-gray-800">
              {body || <span className="italic text-gray-400">No caption — tap Edit to add one.</span>}
            </p>
          )}
        </div>

        {/* Slot picker */}
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            <Calendar className="h-3 w-3" />
            <span>Schedule</span>
          </div>
          <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {dayOptions.map((d) => (
              <button
                key={d}
                onClick={() => setSlot((s) => ({ ...s, day: d }))}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  slot.day === d
                    ? "border-purple-500 bg-purple-50 text-purple-700"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {dayLabel(d)}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {FIXED_SLOT_HOURS.map((h) => (
              <button
                key={h}
                onClick={() => setSlot((s) => ({ ...s, hour: h }))}
                className={`flex-1 rounded-lg border py-1.5 text-[12px] font-semibold transition-colors ${
                  slot.hour === h
                    ? "border-purple-500 bg-purple-50 text-purple-700"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {formatSlotHour(h)}
              </button>
            ))}
          </div>
        </div>

        {/* Platforms */}
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            Publish to
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PUBLISHABLE_PLATFORMS.map(({ key, label, Icon, color }) => {
              const active = platforms.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => togglePlatform(key)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  <Icon className={`h-3.5 w-3.5 ${active ? "text-white" : color}`} />
                  {label}
                </button>
              );
            })}
          </div>
          <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-[12px] text-amber-900">
            <input
              type="checkbox"
              checked={reminderFb}
              onChange={(e) => setReminderFb(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-300"
            />
            <span className="flex-1">
              <span className="flex items-center gap-1 font-semibold">
                <Bell className="h-3 w-3" />
                FB personal reminder
              </span>
              <span className="block text-[11px] text-amber-800">
                Get a notification before this slot to manually post on Facebook personal.
              </span>
            </span>
          </label>
        </div>
      </div>

      {/* Action bar — pinned to bottom on mobile */}
      <div
        className="sticky bottom-0 mt-auto flex shrink-0 items-stretch gap-2 border-t border-gray-200 bg-white/95 px-3 py-2 backdrop-blur"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
      >
        <button
          onClick={onSkip}
          disabled={accepting || accepted}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Skip
        </button>
        <button
          onClick={handleAccept}
          disabled={accepting || accepted || platforms.length === 0}
          className="flex flex-[2] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {accepting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" strokeWidth={2.5} />}
          {accepted ? "Scheduled!" : `Schedule ${formatSlotHour(slot.hour)} ${slot.day.slice(5)}`}
        </button>
      </div>
    </div>
  );
}
