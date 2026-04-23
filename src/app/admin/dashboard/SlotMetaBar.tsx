"use client";

import { Film, ImageIcon, Type, Leaf, Clock, Sun } from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FACEBOOK_PAGE: SiFacebook,
  facebook_page: SiFacebook,
  FACEBOOK: SiFacebook,
  facebook: SiFacebook,
  INSTAGRAM: SiInstagram,
  instagram: SiInstagram,
  LINKEDIN: FaLinkedin,
  linkedin: FaLinkedin,
  YOUTUBE: SiYoutube,
  youtube: SiYoutube,
  TIKTOK: SiTiktok,
  tiktok: SiTiktok,
};

const STATUS_BORDER: Record<string, string> = {
  PROPOSED: "border-l-amber-400",
  APPROVED: "border-l-blue-500",
  SCHEDULED: "border-l-green-500",
  SKIPPED: "border-l-gray-300",
};

const STATUS_BG: Record<string, string> = {
  PROPOSED: "bg-white",
  APPROVED: "bg-blue-50/70 border-blue-100",
  SCHEDULED: "bg-green-50/70 border-green-100",
  SKIPPED: "bg-gray-50 border-gray-200",
};

const STATUS_BADGE: Record<string, string> = {
  PROPOSED: "bg-amber-100 text-amber-700",
  APPROVED: "bg-blue-100 text-blue-700",
  SCHEDULED: "bg-green-100 text-green-700",
  SKIPPED: "bg-gray-100 text-gray-500",
};

function timeSince(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const months = Math.round((now - then) / (1000 * 60 * 60 * 24 * 30));
  if (months < 1) return "recent";
  if (months < 12) return `${months}mo ago`;
  const years = Math.round(months / 12);
  return `${years}y ago`;
}

interface SlotMetaBarProps {
  hasVideo: boolean;
  mediaCount: number;
  postType: "POST" | "REEL" | "STORY";
  lifecycle: string;
  rating: number | null;
  lastPublishedAt: string;
  originalDate: string;
  publishCount: number;
  status: string;
  platforms: string[];
}

export function SlotMetaBar({
  hasVideo,
  mediaCount,
  postType,
  lifecycle,
  rating,
  lastPublishedAt,
  originalDate,
  publishCount,
  status,
  platforms,
}: SlotMetaBarProps) {
  const ContentIcon = hasVideo ? Film : mediaCount > 0 ? ImageIcon : Type;

  const LifecycleIcon =
    lifecycle === "EVERGREEN" ? Leaf :
    lifecycle === "SEASONAL" ? Sun :
    Clock;
  const lifecycleColor =
    lifecycle === "EVERGREEN" ? "text-green-500" :
    lifecycle === "SEASONAL" ? "text-amber-500" :
    "text-gray-300";
  const lifecycleLabel =
    lifecycle === "EVERGREEN" ? "Evergreen" :
    lifecycle === "SEASONAL" ? "Seasonal" :
    lifecycle === "EPHEMERAL" ? "Ephemeral" : "";

  return (
    <div className="flex items-center justify-between gap-2">
      {/* Left: metadata indicators */}
      <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
        {/* Content type badge — always visible */}
        <div className="flex items-center gap-1">
          <ContentIcon className="h-4 w-4 text-gray-400" />
          {hasVideo ? (
            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-700">
              Video
            </span>
          ) : mediaCount > 0 ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
              Image
            </span>
          ) : (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
              Text
            </span>
          )}
        </div>

        {/* Lifecycle */}
        {lifecycle !== "UNKNOWN" && (
          <div className="flex items-center gap-0.5" title={lifecycleLabel}>
            <LifecycleIcon className={`h-4 w-4 ${lifecycleColor}`} />
          </div>
        )}

        {/* Rating dots */}
        {rating != null && (
          <div className="flex items-center gap-0.5" title={`${rating}/5 stars`}>
            {Array.from({ length: 5 }, (_, i) => (
              <div
                key={i}
                className={`h-2 w-2 rounded-full ${
                  i < rating ? "bg-yellow-400" : "bg-gray-200"
                }`}
              />
            ))}
          </div>
        )}

        {/* Original date badge */}
        {originalDate && (
          <span
            className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-600"
            title={`Originally posted ${new Date(originalDate).toLocaleDateString()}`}
          >
            📅 {timeSince(originalDate)}
          </span>
        )}

        {/* Publish status badge */}
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            publishCount === 0
              ? "bg-purple-50 text-purple-600"
              : "bg-gray-100 text-gray-500"
          }`}
        >
          {publishCount === 0 ? "never republished" : `republished ${timeSince(lastPublishedAt)}`}
        </span>
      </div>

      {/* Right: platforms + status */}
      <div className="flex items-center gap-1.5">
        {platforms.map((p) => {
          const Icon = PLATFORM_ICONS[p];
          return Icon ? <Icon key={p} className="h-3.5 w-3.5 text-gray-400" /> : null;
        })}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_BADGE[status] ?? STATUS_BADGE.PROPOSED}`}>
          {status}
        </span>
      </div>
    </div>
  );
}

export { STATUS_BORDER, STATUS_BG };
