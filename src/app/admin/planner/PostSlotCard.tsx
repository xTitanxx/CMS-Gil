"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pencil, Trash2, ExternalLink, FileText, Check, Film, Play, CalendarCheck } from "lucide-react";
import { PLATFORM_META, dedupePlatforms } from "@/lib/planner/platforms";
import { formatSlotHour } from "@/lib/planner/format-slot";
import { useAutoSavePost } from "@/hooks/useAutoSavePost";
import type { PlanSlotData } from "@/lib/planner/types";

interface PostSlotCardProps {
  slot: PlanSlotData;
  /** Cancels publish + removes the slot from the visible plan. */
  onUnschedule: (slotId: string) => void;
  /** Flips a PROPOSED slot to SCHEDULED (creates the PublishRecord). Absent for already-scheduled slots. */
  onSchedule?: (slotId: string) => void;
  /** Reflect inline caption edits back up so the in-memory plan stays in sync without a refetch. */
  onBodyChange?: (postId: string, body: string) => void;
}

type StatusKind = "scheduled" | "proposed" | "published";

function statusKind(slot: PlanSlotData): StatusKind {
  if (slot.published) return "published";
  if (slot.status === "SCHEDULED") return "scheduled";
  return "proposed";
}

const STATUS_STYLES: Record<StatusKind, {
  border: string;
  pill: string;
  pillLabel: (hour: number | null) => string;
}> = {
  scheduled: {
    border: "border-green-200",
    pill: "bg-green-50 text-green-700 ring-1 ring-green-200",
    pillLabel: (h) => (h != null ? `Scheduled · ${formatSlotHour(h)}` : "Scheduled"),
  },
  proposed: {
    border: "border-amber-200",
    pill: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    pillLabel: (h) => (h != null ? `Proposed · ${formatSlotHour(h)}` : "Proposed"),
  },
  published: {
    border: "border-gray-200",
    pill: "bg-gray-100 text-gray-600 ring-1 ring-gray-200",
    pillLabel: (h) => (h != null ? `Published · ${formatSlotHour(h)}` : "Published"),
  },
};

export function PostSlotCard({ slot, onUnschedule, onSchedule, onBodyChange }: PostSlotCardProps) {
  const { post } = slot;
  const kind = statusKind(slot);
  const styles = STATUS_STYLES[kind];

  const [posterFailed, setPosterFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { save, status: saveStatus } = useAutoSavePost(post.id);

  useEffect(() => {
    setDraft(post.body);
  }, [post.body]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const platforms = dedupePlatforms(slot.platforms);
  const detailHref = `/admin/posts/${post.id}?from=planner`;

  const showActions = kind !== "published";
  const showSchedule = kind === "proposed" && onSchedule;

  return (
    <article
      className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${styles.border} ${
        kind === "published" ? "opacity-60" : ""
      }`}
    >
      {/* Media — full card width, natural aspect ratio, capped to keep tall portraits sane. */}
      <Link href={detailHref} className="block bg-black">
        {post.thumbUrl && !posterFailed ? (
          <div className="relative w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.thumbUrl}
              alt=""
              onError={() => setPosterFailed(true)}
              className="block w-full max-h-[60vh] object-contain"
            />
            {post.hasVideo && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
                  <Play className="h-6 w-6" fill="currentColor" />
                </span>
              </span>
            )}
          </div>
        ) : (
          <div className="flex h-40 w-full items-center justify-center bg-gray-100 text-gray-400">
            <Film className="h-8 w-8" />
          </div>
        )}
      </Link>

      {/* Status + platforms row */}
      <div className="flex flex-wrap items-center gap-2 px-3 pt-3 sm:px-4">
        <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${styles.pill}`}>
          {styles.pillLabel(slot.hour)}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {platforms.map((p) => {
            const meta = PLATFORM_META[p];
            if (!meta) return null;
            return <meta.Icon key={p} className={`h-4 w-4 shrink-0 ${meta.color}`} />;
          })}
        </div>
      </div>

      {/* Caption — full body, tap to edit. */}
      <div className="px-3 pb-3 pt-2 sm:px-4">
        {editing ? (
          <div className="space-y-1.5">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                save({ body: next });
                onBodyChange?.(post.id, next);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
              className="w-full resize-none rounded-lg border border-gray-300 bg-white p-2 text-[15px] leading-relaxed text-gray-900 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
              style={{ minHeight: 96 }}
            />
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${
                    saveStatus === "saving"
                      ? "animate-pulse bg-blue-400"
                      : saveStatus === "saved"
                        ? "bg-green-400"
                        : saveStatus === "error"
                          ? "bg-red-400"
                          : "bg-gray-300"
                  }`}
                />
                {saveStatus === "saving"
                  ? "Saving…"
                  : saveStatus === "saved"
                    ? "Saved"
                    : saveStatus === "error"
                      ? "Error"
                      : ""}
              </span>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-gray-100"
              >
                <Check className="h-3.5 w-3.5" /> Done
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => kind !== "published" && setEditing(true)}
            disabled={kind === "published"}
            className="block w-full min-w-0 text-left"
          >
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-900">
              {post.body || <span className="italic text-gray-400">No caption</span>}
            </p>
          </button>
        )}
      </div>

      {/* Action bar */}
      <div className="flex items-stretch gap-1 border-t border-gray-100 bg-gray-50/60 px-2 py-1.5">
        {showSchedule && (
          <button
            type="button"
            onClick={() => onSchedule!(slot.id)}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg bg-green-600 px-2 text-white hover:bg-green-700"
            aria-label="Schedule"
          >
            <CalendarCheck className="h-4 w-4 shrink-0" />
            <span className="truncate text-[12px] font-semibold">Schedule</span>
          </button>
        )}
        {showActions && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-gray-700 hover:bg-white"
            aria-label="Edit caption"
            title="Edit caption"
          >
            <Pencil className="h-4 w-4 shrink-0" />
            <span className="truncate text-[12px] font-medium">Edit</span>
          </button>
        )}
        {showActions && (
          <button
            type="button"
            onClick={() => onUnschedule(slot.id)}
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-gray-700 hover:bg-white"
            aria-label="Unschedule"
            title="Unschedule"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            <span className="truncate text-[12px] font-medium">Remove</span>
          </button>
        )}
        {post.platformUrl ? (
          <a
            href={post.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-gray-700 hover:bg-white"
            aria-label="View original post"
            title="View original post"
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className="truncate text-[12px] font-medium">Original</span>
          </a>
        ) : (
          <span
            className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-gray-300"
            aria-hidden
            title="No original URL"
          >
            <ExternalLink className="h-4 w-4 shrink-0" />
            <span className="truncate text-[12px] font-medium">Original</span>
          </span>
        )}
        <Link
          href={detailHref}
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-1 rounded-lg text-gray-700 hover:bg-white"
          aria-label="Open post detail"
          title="Open post detail"
        >
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate text-[12px] font-medium">Detail</span>
        </Link>
      </div>
    </article>
  );
}
