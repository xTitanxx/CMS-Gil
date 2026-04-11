"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Send, Clock, Video } from "lucide-react";

const PLATFORMS = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"] as const;
type Platform = (typeof PLATFORMS)[number];

const VIDEO_ONLY_PLATFORMS: ReadonlySet<Platform> = new Set(["YOUTUBE", "TIKTOK"]);

const PLATFORM_LABELS: Record<Platform, string> = {
  FACEBOOK_PAGE: "Facebook Page",
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  FACEBOOK_PAGE: "bg-blue-50 border-blue-200 text-blue-700",
  INSTAGRAM: "bg-pink-50 border-pink-200 text-pink-700",
  LINKEDIN: "bg-blue-50 border-blue-200 text-blue-800",
  YOUTUBE: "bg-red-50 border-red-200 text-red-700",
  TIKTOK: "bg-gray-900 border-gray-700 text-white",
};

interface PublishPanelProps {
  postId: string;
  hasVideo: boolean;
  onPublished?: () => void;
}

export function PublishPanel({ postId, hasVideo, onPublished }: PublishPanelProps) {
  const [selected, setSelected] = useState<Set<Platform>>(new Set());
  const [scheduledAt, setScheduledAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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
