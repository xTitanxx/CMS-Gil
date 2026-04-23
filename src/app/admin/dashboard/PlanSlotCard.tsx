"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, RefreshCw, X, Film, ExternalLink } from "lucide-react";
import { SlotMetaBar, STATUS_BORDER, STATUS_BG } from "./SlotMetaBar";
import { AiReasoningTip } from "./AiReasoningTip";
import { InlineCaptionEditor } from "./InlineCaptionEditor";
import type { PlanSlotData } from "@/lib/planner/types";

interface PlanSlotCardProps {
  slot: PlanSlotData;
  onApprove: (slotId: string) => void;
  onRemove: (slotId: string) => void;
  onSwap: (slotId: string) => void;
}

export function PlanSlotCard({ slot, onApprove, onRemove, onSwap }: PlanSlotCardProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(slot.post.body);
  const { post } = slot;

  return (
    <div
      className={`rounded-xl border border-l-[3px] p-4 md:p-5 transition-all hover:shadow-md ${
        STATUS_BORDER[slot.status] ?? STATUS_BORDER.PROPOSED
      } ${STATUS_BG[slot.status] ?? STATUS_BG.PROPOSED}`}
    >
      {/* Row 1: Meta bar */}
      <SlotMetaBar
        hasVideo={post.hasVideo}
        mediaCount={post.mediaCount}
        postType={post.postType}
        lifecycle={post.lifecycle}
        rating={post.rating}
        lastPublishedAt={post.lastPublishedAt}
        originalDate={post.originalDate}
        publishCount={post.publishCount}
        status={slot.status}
        platforms={slot.platforms}
      />

      {/* Row 2: Thumbnail + Caption */}
      <div className="mt-3 flex gap-4 md:mt-4 md:gap-5">
        <Link
          href={`/admin/posts/${post.id}?from=dashboard`}
          className="shrink-0 transition-opacity hover:opacity-80"
        >
          {post.thumbUrl ? (
            post.hasVideo ? (
              <video
                src={post.thumbUrl}
                muted
                preload="metadata"
                className="h-[72px] w-[72px] rounded-xl object-cover md:h-24 md:w-24"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={post.thumbUrl}
                alt=""
                className="h-[72px] w-[72px] rounded-xl object-cover md:h-24 md:w-24"
              />
            )
          ) : (
            <div className="flex h-[72px] w-[72px] items-center justify-center rounded-xl bg-gray-100 text-gray-400 md:h-24 md:w-24">
              <Film className="h-7 w-7" />
            </div>
          )}
        </Link>

        <InlineCaptionEditor
          postId={post.id}
          initialBody={body}
          isOpen={editing}
          onToggle={() => setEditing((o) => !o)}
          onBodyChange={setBody}
        />
      </div>

      {/* Row 3: AI Reasoning + Original link */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <AiReasoningTip reasoning={slot.reasoning} />
        </div>
        {post.platformUrl && (
          <a
            href={post.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-blue-600 shadow-sm hover:bg-blue-50 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
            Original
          </a>
        )}
      </div>

      {/* Row 4: Actions (PROPOSED only) */}
      {slot.status === "PROPOSED" && (
        <div className="mt-3 flex items-center gap-2.5">
          <button
            onClick={() => onApprove(slot.id)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-4 text-[13px] font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <CheckCircle className="h-4 w-4" />
            Approve
          </button>
          <button
            onClick={() => onSwap(slot.id)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-[13px] font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Replace
          </button>
          <button
            onClick={() => onRemove(slot.id)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 text-[13px] font-medium text-red-600 shadow-sm hover:bg-red-50 transition-colors"
          >
            <X className="h-4 w-4" />
            Remove
          </button>
        </div>
      )}

      {/* Approved/Scheduled confirmation indicator */}
      {(slot.status === "APPROVED" || slot.status === "SCHEDULED") && (
        <div className="mt-3 flex items-center gap-1.5">
          <CheckCircle className={`h-4 w-4 ${slot.status === "SCHEDULED" ? "text-green-500" : "text-blue-500"}`} />
          <span className={`text-[13px] font-medium ${slot.status === "SCHEDULED" ? "text-green-600" : "text-blue-600"}`}>
            {slot.status === "SCHEDULED" ? "Scheduled for publishing" : "Approved — ready to schedule"}
          </span>
        </div>
      )}
    </div>
  );
}
