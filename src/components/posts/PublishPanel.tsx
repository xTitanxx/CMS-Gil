"use client";

import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Clock, Video, Copy, Check, HelpCircle, Download } from "lucide-react";

const PLATFORMS = ["INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK", "FACEBOOK_PAGE"] as const;
type Platform = (typeof PLATFORMS)[number];

const VIDEO_ONLY_PLATFORMS: ReadonlySet<Platform> = new Set(["YOUTUBE", "TIKTOK"]);

const PLATFORM_LABELS: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  FACEBOOK_PAGE: "Facebook Page",
};

// LinkedIn uses text-blue-800 so it doesn't look identical to the
// Facebook Page row (text-blue-700) when both are selected.
const PLATFORM_COLORS: Record<Platform, string> = {
  INSTAGRAM: "bg-pink-50 border-pink-200 text-pink-700",
  LINKEDIN: "bg-blue-50 border-blue-200 text-blue-800",
  YOUTUBE: "bg-red-50 border-red-200 text-red-700",
  TIKTOK: "bg-gray-900 border-gray-700 text-white",
  FACEBOOK_PAGE: "bg-blue-50 border-blue-200 text-blue-700",
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
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDisabled = (p: Platform) => VIDEO_ONLY_PLATFORMS.has(p) && !hasVideo;

  const toggle = (p: Platform) => {
    if (isDisabled(p)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const publish = async () => {
    if (selected.size === 0) {
      setError("Select at least one platform");
      return;
    }
    setLoading(true);
    setError("");
    setSuccess("");

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

    const isScheduled = !!scheduledAt;
    setSuccess(
      isScheduled
        ? `Scheduled to ${selected.size} platform(s)`
        : `Publishing to ${selected.size} platform(s)...`
    );
    setSelected(new Set());
    setScheduledAt("");
    onPublished?.();
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
        const res = await fetch(m.url);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Publish</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Platform selector */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
            Select Platforms
          </p>
          {PLATFORMS.map((p) => {
            const disabled = isDisabled(p);
            return (
              <button
                key={p}
                onClick={() => toggle(p)}
                disabled={disabled}
                title={disabled ? `${PLATFORM_LABELS[p]} requires a video — this post has no video` : undefined}
                aria-disabled={disabled}
                className={`w-full rounded-lg border px-3 py-2 text-left text-sm font-medium transition-all ${
                  disabled
                    ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                    : selected.has(p)
                    ? PLATFORM_COLORS[p] + " ring-2 ring-offset-1 ring-current"
                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span>{PLATFORM_LABELS[p]}</span>
                  {disabled ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-gray-400">
                      <Video className="h-3 w-3" />
                      Video only
                    </span>
                  ) : (
                    selected.has(p) && (
                      <Badge variant="success" className="text-xs">
                        Selected
                      </Badge>
                    )
                  )}
                </div>
              </button>
            );
          })}

          {/* Manual Facebook (Personal) action row — not a toggle */}
          <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-blue-700">
                <span className="font-medium">Facebook (Personal)</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  Manual
                </span>
                <span className="group relative inline-flex focus-within:outline-none">
                  <button
                    type="button"
                    aria-label="Why is Facebook manual?"
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 hover:text-gray-600 focus:text-gray-600 focus:outline-none"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-64 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                  >
                    Meta&apos;s Graph API doesn&apos;t allow publishing to personal
                    Facebook profiles, even in Professional Mode. Copy the caption and
                    paste it into the Facebook app to post.
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={copyCaption}
                  disabled={!body}
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      Copy caption
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={downloadMedia}
                  disabled={downloading || downloadableCount === 0}
                  title={
                    downloadableCount === 0
                      ? "No media on this post"
                      : `Download ${downloadableCount} file${downloadableCount === 1 ? "" : "s"} to your Downloads folder`
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3 w-3" />
                  {downloading
                    ? "Downloading…"
                    : downloadableCount > 1
                    ? `Download media (${downloadableCount})`
                    : "Download media"}
                </button>
              </div>
            </div>
            {!body && downloadableCount === 0 && (
              <p className="mt-1 text-[11px] text-gray-400">
                No caption and no media — nothing to copy or download.
              </p>
            )}
            {!body && downloadableCount > 0 && (
              <p className="mt-1 text-[11px] text-gray-400">
                No caption — only media can be downloaded.
              </p>
            )}
            {body && downloadableCount === 0 && (
              <p className="mt-1 text-[11px] text-gray-400">
                No media on this post.
              </p>
            )}
            {copyError && (
              <p className="mt-1 text-[11px] text-red-600">{copyError}</p>
            )}
            {downloadError && (
              <p className="mt-1 text-[11px] text-red-600">
                Download failed: {downloadError}
              </p>
            )}
          </div>
        </div>

        {/* Schedule */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Schedule (optional)
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
          {scheduledAt && (
            <button
              onClick={() => setScheduledAt("")}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear — post immediately
            </button>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-green-600">{success}</p>}

        <Button
          onClick={publish}
          disabled={loading || selected.size === 0}
          className="w-full"
        >
          <Send className="h-4 w-4" />
          {loading
            ? "Publishing..."
            : scheduledAt
            ? "Schedule"
            : "Post Now"}
        </Button>
      </CardContent>
    </Card>
  );
}
