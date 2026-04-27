"use client";

import { useState } from "react";
import Link from "next/link";
import { Film, ImageIcon, Type, Leaf, Check, X, Loader2, Sparkles } from "lucide-react";
import { PLATFORM_META, dedupePlatforms } from "../../dashboard/PlanSlotCard";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { formatSlotHour } from "@/lib/planner/format-slot";

export interface ProposalData {
  kind: "proposal";
  postId: string;
  day: string;
  /** Hour-of-day (12/15/18/21, Asia/Jerusalem) the assistant chose; null = noon default. */
  hour: number | null;
  platforms: string[];
  reasoning: string | null;
  post: {
    id: string;
    body: string;
    tags: string[];
    thumbUrl: string | null;
    hasVideo: boolean;
    mediaCount: number;
    lifecycle: "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
    rating: number | null;
    originalDate: string;
    platformUrl: string | null;
    publishCount: number;
    postType: "POST" | "REEL" | "STORY";
  };
}

function formatDay(day: string): string {
  const d = new Date(day + "T00:00:00Z");
  // Compact: "Mon Apr 27" — no comma so it stays on one line in tight footers.
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).replace(",", "");
}

interface ProposalCardProps {
  proposal: ProposalData;
  onApprove: (proposal: ProposalData) => Promise<{ slotId: string; planId: string }>;
  onCancel?: (slotId: string, planId: string) => Promise<void>;
}

type ProposalState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "added"; slotId: string; planId: string }
  | { status: "error" };

export function ProposalCard({ proposal, onApprove, onCancel }: ProposalCardProps) {
  const [state, setState] = useState<ProposalState>({ status: "idle" });
  const [showReason, setShowReason] = useState(false);

  const post = proposal.post;
  const ContentIcon = post.hasVideo ? Film : post.mediaCount > 0 ? ImageIcon : Type;
  const contentLabel = post.hasVideo ? "Video" : post.mediaCount > 0 ? "Image" : "Text";
  const body = post.body.replace(/\s+/g, " ").trim();

  const isAdded = state.status === "added";
  const cardBg = isAdded
    ? "border-[#d6e4d3] bg-[#f0f6ef]"
    : "border-[#ebe3cc] bg-[#fbf7ee]";
  const footerBg = isAdded ? "bg-[#e6ede5]/60" : "bg-[#f5f0e3]/60";
  const dotBg = isAdded ? "bg-green-500" : "bg-[#d4a23e]";

  async function handleApprove() {
    if (state.status === "sending" || state.status === "added") return;
    setState({ status: "sending" });
    try {
      const result = await onApprove(proposal);
      setState({ status: "added", slotId: result.slotId, planId: result.planId });
    } catch {
      setState({ status: "error" });
    }
  }

  async function handleCancel() {
    if (state.status !== "added" || !onCancel) return;
    const { slotId, planId } = state;
    setState({ status: "sending" });
    try {
      await onCancel(slotId, planId);
      setState({ status: "idle" });
    } catch {
      setState({ status: "error" });
    }
  }

  return (
    <div className={`my-2 overflow-hidden rounded-[14px] border transition-shadow hover:shadow-md ${cardBg}`}>
      {post.thumbUrl ? (
        <Link
          href={`/admin/posts/${post.id}?from=assistant`}
          className="relative block w-full overflow-hidden bg-gray-100"
        >
          {/* thumbUrl is .poster.jpg for videos (see buildThumbUrl), so always render as <img>.
              Natural aspect ratio (w-full h-auto) so portraits and landscapes show
              uncropped; max-h caps very tall portraits so the card doesn't dominate. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.thumbUrl} alt="" className="block h-auto w-full max-h-[70vh] object-contain" />
          {post.hasVideo && (
            <span className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white">
              <Film className="h-4 w-4" />
            </span>
          )}
        </Link>
      ) : null}

      <div className="p-3.5 md:p-4">
        <div className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#3a3832]">
            <ContentIcon className="h-3 w-3 text-[#7a7870]" />
            {contentLabel}
          </span>
          {post.lifecycle === "EVERGREEN" && (
            <span title="Evergreen">
              <Leaf className="h-3.5 w-3.5 text-green-500" />
            </span>
          )}
          {post.rating != null && (
            <span
              className="inline-flex items-center gap-0.5 rounded-[8px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700"
              title={`${post.rating}/5`}
            >
              {post.rating}★
            </span>
          )}
          <span className="flex-1" />
        </div>

        {body ? (
          <Link href={`/admin/posts/${post.id}?from=assistant`} className="mt-2.5 block">
            <p className="line-clamp-[6] text-[15px] leading-[1.55] text-[#161513]">{body}</p>
          </Link>
        ) : (
          <p className="mt-2.5 text-[13px] italic text-gray-400">No caption</p>
        )}
      </div>

      <div className={`flex flex-wrap items-center gap-x-1.5 gap-y-1.5 border-t border-black/5 px-3.5 py-2.5 text-[12px] md:px-4 ${footerBg}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotBg}`} />
        <span className="shrink-0 font-semibold text-[#3a3832]">
          {isAdded ? "Scheduled" : state.status === "error" ? "Add failed" : "Proposed"}
        </span>
        <span className="shrink-0 whitespace-nowrap text-[#7a7870]">
          · <span className="font-semibold text-[#161513]">{formatDay(proposal.day)}</span>
          <span className="ml-1 font-semibold text-[#161513]">
            {formatSlotHour(proposal.hour ?? FIXED_SLOT_HOURS[0])}
          </span>
        </span>

        {proposal.reasoning && (
          <button
            type="button"
            onClick={() => setShowReason((v) => !v)}
            className="ml-1 inline-flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-[11px] text-[#7a7870] hover:bg-white/50 hover:text-[#3a3832] transition-colors"
            title={showReason ? "Hide reasoning" : "Why this?"}
          >
            <Sparkles className="h-3 w-3" />
            why
          </button>
        )}

        <span className="flex-1" />

        {dedupePlatforms(proposal.platforms).map((p) => {
          const meta = PLATFORM_META[p];
          if (!meta) return null;
          return <meta.Icon key={p} className={`h-4 w-4 shrink-0 ${meta.color}`} />;
        })}

        {isAdded ? (
          <button
            type="button"
            onClick={handleCancel}
            disabled={!onCancel}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#d6e4d3] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832] disabled:opacity-60"
            title="Remove from planner"
            aria-label="Remove from planner"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleApprove}
            disabled={state.status === "sending"}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#161513] text-white hover:opacity-80 disabled:opacity-60"
            title={state.status === "error" ? "Try again" : "Add to planner"}
            aria-label={state.status === "error" ? "Try again" : "Add to planner"}
          >
            {state.status === "sending" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            )}
          </button>
        )}
      </div>

      {showReason && proposal.reasoning && (
        <div className="border-t border-black/5 bg-white/40 px-3.5 py-2 text-[12px] leading-snug text-[#5a5853]">
          {proposal.reasoning}
        </div>
      )}
    </div>
  );
}
