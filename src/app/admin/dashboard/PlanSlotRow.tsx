"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Film, CheckCircle, RefreshCw, X, Sparkles } from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { format } from "date-fns";
import type { PlanSlotData } from "@/lib/planner/types";

const PLATFORM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  FACEBOOK_PAGE: SiFacebook,
  INSTAGRAM: SiInstagram,
  LINKEDIN: FaLinkedin,
  YOUTUBE: SiYoutube,
  TIKTOK: SiTiktok,
};

const STATUS_STYLES: Record<string, string> = {
  PROPOSED: "bg-amber-100 text-amber-800 border-amber-200",
  APPROVED: "bg-blue-100 text-blue-800 border-blue-200",
  SCHEDULED: "bg-green-100 text-green-800 border-green-200",
  SKIPPED: "bg-gray-100 text-gray-500 border-gray-200",
};

interface PlanSlotRowProps {
  day: Date;
  slot: PlanSlotData | null;
  onSwap: (day: string) => void;
  onRemove: (slotId: string) => void;
  onApprove: (slotId: string) => void;
}

export function PlanSlotRow({ day, slot, onSwap, onRemove, onApprove }: PlanSlotRowProps) {
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const dayName = format(day, "EEE");
  const dayNum = format(day, "d");
  const dayMonth = format(day, "MMM");
  const dayKey = format(day, "yyyy-MM-dd");

  // Day column (always visible on left) — consistent styling across states
  const dayColumn = (
    <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-md bg-gray-50 py-2 text-center">
      <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{dayName}</span>
      <span className="text-xl font-bold leading-tight text-gray-900">{dayNum}</span>
      <span className="text-[11px] font-medium uppercase tracking-wider text-gray-500">{dayMonth}</span>
    </div>
  );

  if (!slot) {
    return (
      <div className="flex items-center gap-4 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3">
        {dayColumn}
        <span className="flex-1 text-sm italic text-gray-400">No post planned for this day</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSwap(dayKey)}
          className="shrink-0"
        >
          Fill slot
        </Button>
      </div>
    );
  }

  const { post } = slot;
  const lastPostedDate = new Date(post.lastPublishedAt || post.originalDate);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-stretch gap-4 p-4">
        {/* Day column */}
        {dayColumn}

        {/* Thumbnail (clickable, larger) */}
        <Link
          href={`/admin/posts/${post.id}?from=dashboard`}
          className="shrink-0 self-stretch transition-opacity hover:opacity-80"
        >
          {post.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbUrl}
              alt="Post thumbnail"
              className="h-24 w-24 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-md bg-gray-100 text-gray-400">
              <Film className="h-8 w-8" />
            </div>
          )}
        </Link>

        {/* Main content (clickable body) */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Status / meta row */}
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider ${STATUS_STYLES[slot.status] ?? STATUS_STYLES.PROPOSED}`}
            >
              {slot.status}
            </span>
            {post.hasVideo && (
              <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-purple-700">
                <Film className="h-3 w-3" />
                Video
              </span>
            )}
            <span className="text-xs text-gray-400">
              Last posted: {format(lastPostedDate, "MMM d, yyyy")}
            </span>
            {post.publishCount > 0 && (
              <span className="text-xs text-gray-400">· Recycled {post.publishCount}×</span>
            )}
          </div>

          {/* Body — larger, more visible */}
          <Link href={`/admin/posts/${post.id}?from=dashboard`} className="group mb-2 block">
            <p className="line-clamp-3 text-sm leading-relaxed text-gray-700 group-hover:text-blue-700">
              {post.body}
            </p>
          </Link>

          {/* Tags + platforms row */}
          <div className="mt-auto flex flex-wrap items-center gap-2">
            {slot.platforms.length > 0 && (
              <div className="flex items-center gap-1.5 border-r border-gray-200 pr-2">
                {slot.platforms.map((p) => {
                  const Icon = PLATFORM_ICONS[p];
                  return Icon ? (
                    <Icon key={p} className="h-4 w-4 text-gray-500" />
                  ) : (
                    <span key={p} className="text-xs text-gray-400">{p}</span>
                  );
                })}
              </div>
            )}
            {post.tags.slice(0, 4).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {post.tags.length > 4 && (
              <span className="text-xs text-gray-400">+{post.tags.length - 4}</span>
            )}
          </div>
        </div>

        {/* Action column */}
        <div className="flex shrink-0 flex-col items-end justify-between gap-2">
          {slot.status === "PROPOSED" && (
            <div className="flex flex-col gap-1.5">
              <Button
                size="sm"
                onClick={() => onApprove(slot.id)}
                className="h-8 gap-1.5 bg-blue-600 text-xs text-white hover:bg-blue-700"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSwap(dayKey)}
                className="h-8 gap-1.5 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Swap
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRemove(slot.id)}
                className="h-8 gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-50"
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          )}

          {slot.reasoning && (
            <button
              onClick={() => setReasoningOpen((o) => !o)}
              className="mt-auto flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-gray-600"
            >
              <Sparkles className="h-3 w-3" />
              Why?
              {reasoningOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Expandable reasoning */}
      {reasoningOpen && slot.reasoning && (
        <div className="border-t border-gray-100 bg-gradient-to-br from-purple-50 to-blue-50 px-4 py-3">
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-purple-700">
            <Sparkles className="h-3 w-3" />
            AI Reasoning
          </p>
          <p className="text-sm leading-relaxed text-gray-700">{slot.reasoning}</p>
        </div>
      )}
    </div>
  );
}
