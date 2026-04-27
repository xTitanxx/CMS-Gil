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
import { formatSlotHour } from "@/lib/planner/format-slot";
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

export const PLATFORM_META: Record<string, { Icon: React.ComponentType<{ className?: string }>; color: string }> = {
  INSTAGRAM: { Icon: SiInstagram, color: "text-[#E1306C]" },
  instagram: { Icon: SiInstagram, color: "text-[#E1306C]" },
  FACEBOOK_PAGE: { Icon: SiFacebook, color: "text-[#1877F2]" },
  facebook_page: { Icon: SiFacebook, color: "text-[#1877F2]" },
  FACEBOOK: { Icon: SiFacebook, color: "text-[#1877F2]" },
  facebook: { Icon: SiFacebook, color: "text-[#1877F2]" },
  LINKEDIN: { Icon: FaLinkedin, color: "text-[#0A66C2]" },
  linkedin: { Icon: FaLinkedin, color: "text-[#0A66C2]" },
  YOUTUBE: { Icon: SiYoutube, color: "text-[#FF0000]" },
  youtube: { Icon: SiYoutube, color: "text-[#FF0000]" },
  TIKTOK: { Icon: SiTiktok, color: "text-[#111111]" },
  tiktok: { Icon: SiTiktok, color: "text-[#111111]" },
};

/** Map a platform key to its canonical brand identity so duplicates collapse
 *  (e.g. FACEBOOK + FACEBOOK_PAGE both render the Facebook icon — show one). */
function platformBrand(p: string): string {
  const u = p.toUpperCase();
  if (u === "FACEBOOK" || u === "FACEBOOK_PAGE") return "FACEBOOK";
  return u;
}

export function dedupePlatforms(platforms: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of platforms) {
    const brand = platformBrand(p);
    if (seen.has(brand)) continue;
    seen.add(brand);
    out.push(p);
  }
  return out;
}

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
  // Compact: "Mon Apr 27" — no comma so it stays on one line in tight footers.
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .replace(",", "");
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
      {/* ── Desktop spine: dot + line (hidden on mobile) ── */}
      <div className="hidden w-5 shrink-0 flex-col items-center md:flex">
        <div className="h-5" />
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
                <div className="relative">
                  {/* thumbUrl is .poster.jpg for videos, so render as <img> in both cases. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.thumbUrl}
                    alt=""
                    className="h-[72px] w-[72px] rounded-[10px] object-cover md:h-[92px] md:w-[92px]"
                  />
                  {post.hasVideo && (
                    <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-white">
                      <Film className="h-3 w-3" />
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[10px] bg-white/50 text-[#7a7870] md:h-[92px] md:w-[92px]">
                  <Film className="h-7 w-7" />
                </div>
              )}
            </Link>

            {/* Right column */}
            <div className="min-w-0 flex-1">
              {/* Row 1: type · leaf · stars ··· original-link */}
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-[8px] border border-[#eae7df] bg-white/70 px-2 py-0.5 text-[11px] font-medium text-[#3a3832]">
                  <ContentIcon className="h-3 w-3 text-[#7a7870]" />
                  {contentLabel}
                </span>
                {post.lifecycle === "EVERGREEN" && (
                  <span title="Evergreen"><Leaf className="h-3.5 w-3.5 text-green-500" /></span>
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
                {post.platformUrl && (
                  <a
                    href={post.platformUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#eae7df] bg-white text-[#7a7870] hover:text-[#3a3832] hover:bg-gray-50 transition-colors md:h-7 md:w-7"
                    title="View original post"
                  >
                    <ExternalLink className="h-3 w-3 md:h-3.5 md:w-3.5" />
                  </a>
                )}
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
          {/* Wraps on narrow widths so the action buttons stay reachable. */}
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 text-[12px]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[slot.status] ?? STATUS_DOT.PROPOSED}`} />
            <span className="shrink-0 font-semibold text-[#3a3832]">
              {isScheduled ? "Scheduled" : "Proposed"}
            </span>
            {slot.day && (
              <span className="shrink-0 whitespace-nowrap text-[#7a7870]">
                · <span className="font-semibold text-[#161513]">{formatScheduleDate(slot.day)}</span>
                {slot.hour != null && (
                  <span className="ml-1 font-semibold text-[#161513]">{formatSlotHour(slot.hour)}</span>
                )}
              </span>
            )}

            <span className="flex-1" />

            {dedupePlatforms(slot.platforms).map((p) => {
              const meta = PLATFORM_META[p];
              if (!meta) return null;
              return (
                <meta.Icon key={p} className={`h-4 w-4 shrink-0 ${meta.color}`} />
              );
            })}

            {isProposed && (
              <>
                <button onClick={() => onRemove(slot.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#eae7df] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832]" title="Skip"><X className="h-3.5 w-3.5" /></button>
                <button onClick={() => onApprove(slot.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#161513] text-white hover:opacity-80" title="Schedule"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /></button>
              </>
            )}
            {isScheduled && (
              <button onClick={() => onRemove(slot.id)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-[#eae7df] bg-white text-[#7a7870] hover:bg-gray-50 hover:text-[#3a3832]" title="Unschedule"><X className="h-3.5 w-3.5" /></button>
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
