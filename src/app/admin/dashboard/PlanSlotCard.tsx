"use client";

import Link from "next/link";
import {
  Film,
  ImageIcon,
  Type,
  Leaf,
  Clock,
  RotateCcw,
  Check,
  X,
  ExternalLink,
} from "lucide-react";
import { SiFacebook, SiInstagram, SiYoutube, SiTiktok } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { AiReasoningTip } from "./AiReasoningTip";
import type { PlanSlotData } from "@/lib/planner/types";

/* ── Status styling ── */

export const STATUS_BG: Record<string, string> = {
  PROPOSED: "bg-[#fbf7ee]",
  APPROVED: "bg-[#fbf7ee]",
  SCHEDULED: "bg-[#f0f6ef]",
  SKIPPED: "bg-gray-50",
};

export const STATUS_BORDER: Record<string, string> = {
  PROPOSED: "border-[#ebe3cc]",
  APPROVED: "border-[#ebe3cc]",
  SCHEDULED: "border-[#d6e4d3]",
  SKIPPED: "border-gray-200",
};

const STATUS_FOOTER_BG: Record<string, string> = {
  PROPOSED: "bg-[#f5f0e3]/60",
  APPROVED: "bg-[#f5f0e3]/60",
  SCHEDULED: "bg-[#e6ede5]/60",
};

const STATUS_DOT: Record<string, string> = {
  PROPOSED: "bg-[#d4a23e]",
  APPROVED: "bg-[#d4a23e]",
  SCHEDULED: "bg-green-500",
};

export const SPINE_RING: Record<string, string> = {
  PROPOSED: "border-[#d4a23e]",
  APPROVED: "border-[#d4a23e]",
  SCHEDULED: "border-green-500",
};

/* ── Platform config ── */

const PLATFORM_META: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string; bg: string }> = {
  INSTAGRAM: { Icon: SiInstagram, color: "text-[#E1306C]", bg: "bg-[#FCE7F0]" },
  instagram: { Icon: SiInstagram, color: "text-[#E1306C]", bg: "bg-[#FCE7F0]" },
  FACEBOOK_PAGE: { Icon: SiFacebook, color: "text-[#1877F2]", bg: "bg-[#E5EFFE]" },
  facebook_page: { Icon: SiFacebook, color: "text-[#1877F2]", bg: "bg-[#E5EFFE]" },
  FACEBOOK: { Icon: SiFacebook, color: "text-[#1877F2]", bg: "bg-[#E5EFFE]" },
  facebook: { Icon: SiFacebook, color: "text-[#1877F2]", bg: "bg-[#E5EFFE]" },
  LINKEDIN: { Icon: FaLinkedin, color: "text-[#0A66C2]", bg: "bg-[#E3EEF9]" },
  linkedin: { Icon: FaLinkedin, color: "text-[#0A66C2]", bg: "bg-[#E3EEF9]" },
  YOUTUBE: { Icon: SiYoutube, color: "text-[#FF0000]", bg: "bg-[#FDE7E7]" },
  youtube: { Icon: SiYoutube, color: "text-[#FF0000]", bg: "bg-[#FDE7E7]" },
  TIKTOK: { Icon: SiTiktok, color: "text-[#111111]", bg: "bg-[#ECECEC]" },
  tiktok: { Icon: SiTiktok, color: "text-[#111111]", bg: "bg-[#ECECEC]" },
};

/* ── Helpers ── */

function timeSince(dateStr: string): string {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const days = Math.round((now - then) / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

function formatScheduleDate(dayStr: string): string {
  const d = new Date(dayStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/* ── Component ── */

interface PlanSlotCardProps {
  slot: PlanSlotData;
  onApprove: (slotId: string) => void;
  onRemove: (slotId: string) => void;
  onSwap: (slotId: string) => void;
  isLast?: boolean;
}

export function PlanSlotCard({ slot, onApprove, onRemove, isLast }: PlanSlotCardProps) {
  const { post } = slot;
  const isProposed = slot.status === "PROPOSED" || slot.status === "APPROVED";
  const isScheduled = slot.status === "SCHEDULED";

  const ContentIcon = post.hasVideo ? Film : post.mediaCount > 0 ? ImageIcon : Type;
  const contentLabel = post.hasVideo ? "Video" : post.mediaCount > 0 ? "Image" : "Text";

  const body = post.body.replace(/\s+/g, " ").trim();
  const truncated = body.length > 120 ? body.slice(0, 120).trimEnd() + "…" : body;

  return (
    <div className="flex gap-0 md:gap-0">
      {/* ── Desktop timeline spine (hidden on mobile) ── */}
      <div className="hidden w-[80px] shrink-0 flex-col items-end md:flex">
        {/* Time label — placeholder; real times would come from scheduledAt */}
        <div className="pr-3 pt-4 text-right">
          <div className="text-[13px] font-semibold text-[#161513]">
            {formatScheduleDate(slot.day).split(",")[0]}
          </div>
          <div className="text-[11px] text-[#7a7870]">
            {formatScheduleDate(slot.day).split(", ").slice(1).join(", ")}
          </div>
        </div>
      </div>

      {/* ── Spine dot + line (hidden on mobile) ── */}
      <div className="hidden w-[20px] flex-col items-center md:flex">
        <div className="h-4" />
        <div className={`h-[11px] w-[11px] shrink-0 rounded-full border-[2.5px] bg-white ${SPINE_RING[slot.status] ?? SPINE_RING.PROPOSED}`} />
        {!isLast && <div className="w-[1.5px] flex-1 bg-[#eae7df]" />}
      </div>

      {/* ── Card ── */}
      <div
        className={`flex-1 overflow-hidden rounded-[14px] border transition-shadow hover:shadow-md ${
          STATUS_BORDER[slot.status] ?? STATUS_BORDER.PROPOSED
        } ${STATUS_BG[slot.status] ?? STATUS_BG.PROPOSED}`}
      >
        {/* Top section */}
        <div className="p-3.5 md:p-4">
          <div className="flex gap-3 md:gap-3.5">
            {/* Thumbnail */}
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
                    className="h-[72px] w-[72px] rounded-[10px] object-cover md:h-[92px] md:w-[92px]"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.thumbUrl}
                    alt=""
                    className="h-[72px] w-[72px] rounded-[10px] object-cover md:h-[92px] md:w-[92px]"
                  />
                )
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[10px] bg-white/50 text-[#7a7870] md:h-[92px] md:w-[92px]">
                  <Film className="h-7 w-7" />
                </div>
              )}
            </Link>

            {/* Right column */}
            <div className="min-w-0 flex-1">
              {/* Row 1: type · leaf · stars ··· platforms */}
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#3a3832]">
                  <ContentIcon className="h-3 w-3 text-[#7a7870]" />
                  {contentLabel}
                </span>
                {post.lifecycle === "EVERGREEN" && (
                  <span title="Evergreen"><Leaf className="h-3.5 w-3.5 text-green-500" /></span>
                )}
                {post.rating != null && (
                  <span className="inline-flex items-center gap-px" title={`${post.rating}/5`}>
                    {Array.from({ length: 5 }, (_, i) => (
                      <svg key={i} viewBox="0 0 16 16" className="h-3 w-3" fill={i < post.rating! ? "#d4a23e" : "#ddd"}>
                        <path d="M8 1.12l1.95 3.95 4.36.64-3.16 3.08.75 4.33L8 10.93l-3.9 2.19.75-4.33L1.69 5.71l4.36-.64L8 1.12z" />
                      </svg>
                    ))}
                  </span>
                )}
                <span className="flex-1" />
                {slot.platforms.map((p) => {
                  const meta = PLATFORM_META[p];
                  if (!meta) return null;
                  return (
                    <span key={p} className={`inline-flex h-6 w-6 items-center justify-center rounded-[7px] ${meta.bg} md:h-7 md:w-7`}>
                      <meta.Icon className={`h-3 w-3 ${meta.color} md:h-3.5 md:w-3.5`} />
                    </span>
                  );
                })}
              </div>

              {/* Row 2: text */}
              <Link href={`/admin/posts/${post.id}?from=dashboard`} className="mt-1.5 block">
                <p className="line-clamp-2 text-[14px] leading-[1.45] text-[#161513]">{truncated}</p>
              </Link>

              {/* Row 3: meta chips */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {post.originalDate && (
                  <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/50 px-2 py-0.5 text-[11px] text-[#7a7870]">
                    <Clock className="h-3 w-3" />
                    Originally {timeSince(post.originalDate)}
                  </span>
                )}
                <span className={`inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] px-2 py-0.5 text-[11px] ${
                  post.publishCount > 0 ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-white/50 text-[#7a7870]"
                }`}>
                  <RotateCcw className="h-3 w-3" />
                  {post.publishCount > 0 ? `Reposted ${post.publishCount}\u00d7` : "Never reposted"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom section — status + actions on one line, why this? below */}
        <div className={`border-t border-black/5 px-3.5 py-2.5 md:px-4 ${STATUS_FOOTER_BG[slot.status] ?? STATUS_FOOTER_BG.PROPOSED}`}>
          {/* Single row: status + date + spacer + original link + actions */}
          <div className="flex items-center gap-2 text-[13px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[slot.status] ?? STATUS_DOT.PROPOSED}`} />
            <span className="font-semibold text-[#3a3832]">
              {isScheduled ? "Scheduled" : "Proposed"}
            </span>
            {slot.day && (
              <span className="text-[#7a7870]">
                · <span className="font-semibold text-[#161513]">{formatScheduleDate(slot.day)}</span>
              </span>
            )}

            <span className="flex-1" />

            {post.platformUrl && (
              <a
                href={post.platformUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-[7px] border border-[#eae7df] bg-white px-2 py-1 text-[11px] text-[#7a7870] hover:text-[#3a3832] hover:bg-gray-50 transition-colors"
                title="View original post"
              >
                <ExternalLink className="h-3 w-3" />
                <span className="hidden sm:inline">Original</span>
              </a>
            )}

            {isProposed && (
              <>
                <button onClick={() => onRemove(slot.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#eae7df] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832]" title="Skip"><X className="h-4 w-4" /></button>
                <button onClick={() => onApprove(slot.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#161513] text-white hover:opacity-80" title="Schedule"><Check className="h-4 w-4" strokeWidth={2.5} /></button>
              </>
            )}
            {isScheduled && (
              <button onClick={() => onRemove(slot.id)} className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#eae7df] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832]" title="Unschedule"><X className="h-4 w-4" /></button>
            )}
          </div>

          {/* Why this? — collapsed, below the status row */}
          {slot.reasoning && (
            <div className="mt-1.5">
              <AiReasoningTip reasoning={slot.reasoning} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
