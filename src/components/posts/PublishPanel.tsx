"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Clock, Copy, Check, HelpCircle, Download, CalendarClock } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import {
  ineligibilityReason,
  isPlatformEligible,
  mediaShapeFromMimeTypes,
} from "@/lib/platform-eligibility";

const PLATFORMS = ["INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK", "FACEBOOK_PAGE"] as const;
type Platform = (typeof PLATFORMS)[number];

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const PLATFORM_ICONS: Record<Platform, IconComponent> = {
  INSTAGRAM: SiInstagram as unknown as IconComponent,
  LINKEDIN: FaLinkedin as unknown as IconComponent,
  YOUTUBE: SiYoutube as unknown as IconComponent,
  TIKTOK: SiTiktok as unknown as IconComponent,
  FACEBOOK_PAGE: SiFacebook as unknown as IconComponent,
};

const PLATFORM_LABELS: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  FACEBOOK_PAGE: "Facebook Page",
};

const PLATFORM_COLORS_SELECTED: Record<Platform, string> = {
  INSTAGRAM: "bg-pink-100 border-pink-300 text-pink-700",
  LINKEDIN: "bg-blue-100 border-blue-300 text-blue-800",
  YOUTUBE: "bg-red-100 border-red-300 text-red-700",
  TIKTOK: "bg-gray-900 border-gray-700 text-white",
  FACEBOOK_PAGE: "bg-blue-100 border-blue-300 text-blue-700",
};

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

export interface PublishPanelMedia {
  id: string;
  url: string | null;
  mimeType: string;
}

interface PublishPanelProps {
  postId: string;
  body: string;
  hasVideo: boolean;
  media: PublishPanelMedia[];
  onPublished?: () => void;
}

export function PublishPanel({ postId, body, hasVideo, media, onPublished }: PublishPanelProps) {
  // Eligibility is derived from the actual media-type mix, not just hasVideo:
  // Instagram needs photo-or-video, FB/LI accept anything, YT/TT need video.
  // hasVideo is still respected as a hint (some callers pre-compute it before
  // media URLs are available).
  const shape = useMemo(() => {
    const baseline = mediaShapeFromMimeTypes(media.map((m) => m.mimeType));
    return { ...baseline, hasVideo: baseline.hasVideo || hasVideo };
  }, [media, hasVideo]);

  const enabledPlatforms = useMemo(
    () => PLATFORMS.filter((p) => isPlatformEligible(p, shape)),
    [shape]
  );

  // Default selection = every eligible platform. Re-derive whenever the
  // eligibility set changes (e.g. user adds/removes media) so the picker stays
  // in sync with the rule "always select all those that are possible". Keyed
  // on the joined platform list rather than the array reference to avoid
  // re-running on every parent render.
  const eligibilityKey = enabledPlatforms.join(",");
  const [selected, setSelected] = useState<Set<Platform>>(() => new Set(enabledPlatforms));
  useEffect(() => {
    setSelected(new Set(enabledPlatforms));
    // enabledPlatforms is derived from eligibilityKey; keying on the string
    // gives stable, content-based comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligibilityKey]);

  const [scheduledAt, setScheduledAt] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDisabled = (p: Platform) => !isPlatformEligible(p, shape);

  const toggle = (p: Platform) => {
    if (isDisabled(p)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(enabledPlatforms));
  };

  const publish = async () => {
    if (selected.size === 0) {
      setError("Select at least one platform");
      return;
    }
    setLoading(true);
    setError("");

    const res = await fetch(`/api/posts/${postId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platforms: Array.from(selected),
        scheduledAt: scheduledAt || undefined,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Failed to publish");
      return;
    }

    setSelected(new Set());
    setScheduledAt("");
    setShowSchedule(false);
    onPublished?.();
  };

  const publishAll = async () => {
    selectAll();
    // Small delay so state updates before publish
    setTimeout(async () => {
      setLoading(true);
      setError("");
      const res = await fetch(`/api/posts/${postId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platforms: enabledPlatforms,
          scheduledAt: scheduledAt || undefined,
        }),
      });
      const data = await res.json();
      setLoading(false);
      if (!res.ok) {
        setError(data.error ?? "Failed to publish");
        return;
      }
      setSelected(new Set());
      setScheduledAt("");
      setShowSchedule(false);
      onPublished?.();
    }, 0);
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
    const downloadable = media.filter((m): m is PublishPanelMedia & { url: string } => !!m.url);
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

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Publish</h3>
      </div>
      <div className="space-y-3.5 px-4 pb-4">
        {/* Platform chips */}
        <div className="flex flex-wrap items-center gap-2">
          {PLATFORMS.map((p) => {
            const reason = ineligibilityReason(p, shape);
            const disabled = reason !== null;
            const Icon = PLATFORM_ICONS[p];
            const active = selected.has(p);
            return (
              <button
                key={p}
                onClick={() => toggle(p)}
                disabled={disabled}
                title={disabled ? `${PLATFORM_LABELS[p]} — ${reason}` : PLATFORM_LABELS[p]}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                  disabled
                    ? "border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed"
                    : active
                    ? PLATFORM_COLORS_SELECTED[p] + " shadow-sm"
                    : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {PLATFORM_LABELS[p]}
              </button>
            );
          })}
        </div>

        {/* Schedule toggle */}
        {showSchedule && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-gray-400" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="flex-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => { setScheduledAt(""); setShowSchedule(false); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <Button
            onClick={publish}
            disabled={loading || selected.size === 0}
            className="flex-1 gap-1.5"
            size="sm"
          >
            <Send className="h-3.5 w-3.5" />
            {loading ? "Publishing..." : scheduledAt ? "Schedule" : "Post Now"}
            {selected.size > 0 && ` (${selected.size})`}
          </Button>
          <Button
            onClick={publishAll}
            disabled={loading}
            variant="outline"
            size="sm"
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            {scheduledAt ? "Schedule All" : "Post All"}
          </Button>
          {!showSchedule && (
            <Button
              onClick={() => setShowSchedule(true)}
              variant="ghost"
              size="sm"
              className="gap-1 text-gray-500"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Schedule</span>
            </Button>
          )}
        </div>

        {/* Facebook Personal (manual) — compact row */}
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs text-blue-700">
            <SiFacebook size={14} aria-hidden="true" className="shrink-0" />
            <span className="font-medium">FB Personal</span>
            <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gray-500">
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
          <div className="flex items-center gap-1.5 ml-auto">
            <button
              type="button"
              onClick={copyCaption}
              disabled={!body}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
            </button>
            <button
              type="button"
              onClick={downloadMedia}
              disabled={downloading || downloadableCount === 0}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              {downloading ? "..." : "Media"}
            </button>
          </div>
        </div>
        {copyError && <p className="text-[11px] text-red-600">{copyError}</p>}
        {downloadError && <p className="text-[11px] text-red-600">Download: {downloadError}</p>}
      </div>
    </div>
  );
}
