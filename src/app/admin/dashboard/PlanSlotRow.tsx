"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Film, CheckCircle, RefreshCw, X } from "lucide-react";
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
  const dayLabel = format(day, "EEE, MMM d");
  const dayKey = format(day, "yyyy-MM-dd");

  if (!slot) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
        <span className="w-24 shrink-0 text-sm font-medium text-gray-500">{dayLabel}</span>
        <span className="flex-1 text-sm text-gray-400 italic">No post planned</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onSwap(dayKey)}
          className="shrink-0 text-xs"
        >
          Fill slot
        </Button>
      </div>
    );
  }

  const { post } = slot;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 px-4 py-3">
        {/* Thumbnail */}
        <div className="shrink-0">
          {post.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbUrl}
              alt="Post thumbnail"
              className="h-12 w-12 rounded object-cover"
            />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-200 text-gray-400">
              <Film className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Top row: day label + status + video badge */}
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">{dayLabel}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[slot.status] ?? STATUS_STYLES.PROPOSED}`}
            >
              {slot.status}
            </span>
            {post.hasVideo && (
              <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                <Film className="h-3 w-3" />
                Video
              </span>
            )}
          </div>

          {/* Body snippet */}
          <p className="mb-2 line-clamp-1 text-sm text-gray-700">{post.body}</p>

          {/* Platform icons + tags + publish count */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Platform icons */}
            {slot.platforms.length > 0 && (
              <div className="flex items-center gap-1">
                {slot.platforms.map((p) => {
                  const Icon = PLATFORM_ICONS[p];
                  return Icon ? (
                    <Icon key={p} className="h-3.5 w-3.5 text-gray-500" />
                  ) : (
                    <span key={p} className="text-xs text-gray-400">{p}</span>
                  );
                })}
              </div>
            )}

            {/* Tags */}
            {post.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
            {post.tags.length > 3 && (
              <span className="text-xs text-gray-400">+{post.tags.length - 3}</span>
            )}

            {/* Publish count */}
            {post.publishCount > 0 && (
              <span className="text-xs text-gray-400">
                Published {post.publishCount}×
              </span>
            )}
          </div>
        </div>

        {/* Action buttons — only for PROPOSED */}
        <div className="flex shrink-0 items-center gap-1">
          {slot.status === "PROPOSED" && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onApprove(slot.id)}
                className="h-7 gap-1 border-blue-200 px-2 text-xs text-blue-700 hover:bg-blue-50"
                title="Approve"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSwap(dayKey)}
                className="h-7 gap-1 px-2 text-xs text-gray-600"
                title="Swap post"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Swap
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRemove(slot.id)}
                className="h-7 gap-1 border-red-200 px-2 text-xs text-red-600 hover:bg-red-50"
                title="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {/* Reasoning toggle */}
          {slot.reasoning && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReasoningOpen((o) => !o)}
              className="h-7 px-1.5 text-gray-400 hover:text-gray-600"
              title="Toggle reasoning"
            >
              {reasoningOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Expandable reasoning */}
      {reasoningOpen && slot.reasoning && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5">
          <p className="text-xs font-medium text-gray-500">AI Reasoning</p>
          <p className="mt-0.5 text-xs text-gray-600">{slot.reasoning}</p>
        </div>
      )}
    </div>
  );
}
