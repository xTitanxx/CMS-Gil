"use client";

import { useState } from "react";
import Link from "next/link";
import { Film, ImageIcon, Type, Leaf, Check, Loader2, Sparkles } from "lucide-react";
import { PLATFORM_META } from "../../dashboard/PlanSlotCard";

export interface ProposalData {
  kind: "proposal";
  postId: string;
  day: string;
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
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

interface ProposalCardProps {
  proposal: ProposalData;
  onApprove: (proposal: ProposalData) => Promise<void>;
}

export function ProposalCard({ proposal, onApprove }: ProposalCardProps) {
  const [status, setStatus] = useState<"idle" | "sending" | "added" | "error">("idle");
  const [showReason, setShowReason] = useState(false);

  const post = proposal.post;
  const ContentIcon = post.hasVideo ? Film : post.mediaCount > 0 ? ImageIcon : Type;
  const contentLabel = post.hasVideo ? "Video" : post.mediaCount > 0 ? "Image" : "Text";
  const body = post.body.replace(/\s+/g, " ").trim();
  const truncated = body.length > 140 ? body.slice(0, 140).trimEnd() + "…" : body;

  async function handleApprove() {
    if (status !== "idle") return;
    setStatus("sending");
    try {
      await onApprove(proposal);
      setStatus("added");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-[14px] border border-[#ebe3cc] bg-[#fbf7ee] transition-shadow hover:shadow-md">
      <div className="p-3.5">
        <div className="flex gap-3">
          <Link
            href={`/admin/posts/${post.id}?from=assistant`}
            className="shrink-0 transition-opacity hover:opacity-80"
          >
            {post.thumbUrl ? (
              post.hasVideo ? (
                <video
                  src={post.thumbUrl}
                  muted
                  preload="metadata"
                  className="h-[72px] w-[72px] rounded-[10px] object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.thumbUrl}
                  alt=""
                  className="h-[72px] w-[72px] rounded-[10px] object-cover"
                />
              )
            ) : (
              <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[10px] bg-white/50 text-[#7a7870]">
                <Film className="h-7 w-7" />
              </div>
            )}
          </Link>

          <div className="min-w-0 flex-1">
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
                <span className="inline-flex items-center gap-px" title={`${post.rating}/5`}>
                  {Array.from({ length: 5 }, (_, i) => (
                    <svg
                      key={i}
                      viewBox="0 0 16 16"
                      className="h-3 w-3"
                      fill={i < (post.rating ?? 0) ? "#d4a23e" : "#ddd"}
                    >
                      <path d="M8 1.12l1.95 3.95 4.36.64-3.16 3.08.75 4.33L8 10.93l-3.9 2.19.75-4.33L1.69 5.71l4.36-.64L8 1.12z" />
                    </svg>
                  ))}
                </span>
              )}
              <span className="flex-1" />
              {proposal.platforms.map((p) => {
                const meta = PLATFORM_META[p];
                if (!meta) return null;
                return (
                  <span
                    key={p}
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-[7px] ${meta.bg}`}
                  >
                    <meta.Icon className={`h-3 w-3 ${meta.color}`} />
                  </span>
                );
              })}
            </div>

            <Link href={`/admin/posts/${post.id}?from=assistant`} className="mt-1.5 block">
              <p className="line-clamp-2 text-[14px] leading-[1.45] text-[#161513]">{truncated}</p>
            </Link>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-black/5 bg-[#f5f0e3]/60 px-3.5 py-2.5 text-[13px]">
        <span className="h-2 w-2 shrink-0 rounded-full bg-[#d4a23e]" />
        <span className="font-semibold text-[#3a3832]">
          {status === "added" ? "Added to planner" : "Proposed"}
        </span>
        <span className="text-[#7a7870]">
          · <span className="font-semibold text-[#161513]">{formatDay(proposal.day)}</span>
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

        {status === "added" ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-green-100 px-3 text-[12px] font-medium text-green-700">
            <Check className="h-4 w-4" strokeWidth={2.5} />
            Added
          </span>
        ) : status === "error" ? (
          <button
            onClick={handleApprove}
            className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-red-200 bg-white px-3 text-[12px] font-medium text-red-600 hover:bg-red-50"
            title="Try again"
          >
            Retry
          </button>
        ) : (
          <button
            onClick={handleApprove}
            disabled={status === "sending"}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#161513] text-white hover:opacity-80 disabled:opacity-60"
            title="Add to planner"
            aria-label="Add to planner"
          >
            {status === "sending" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" strokeWidth={2.5} />
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
