"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
  Share2,
  Trash2,
} from "lucide-react";
import { PageHeader } from "../_shared/PageHeader";
import { PostingHubTabs } from "../_shared/PostingHubTabs";

export type QueueItem = {
  // slotId is null for ad-hoc items (not on the weekly planner).
  slotId: string | null;
  postId: string;
  scheduledAt: string;
  status: "SCHEDULED" | "APPROVED" | "AD_HOC";
  reminderSentAt: string | null;
  body: string;
  platformUrl: string | null;
  media: { id: string; mimeType: string; url: string | null }[];
};

function posterUrl(media: { mimeType: string; url: string | null }[]): string | null {
  const first = media[0];
  if (!first?.url) return null;
  if (first.mimeType.startsWith("video/")) {
    return first.url.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return first.url;
}

function formatScheduled(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  };
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate();

  if (sameDay) return `Today · ${d.toLocaleTimeString([], timeOpts)}`;
  if (isTomorrow) return `Tomorrow · ${d.toLocaleTimeString([], timeOpts)}`;
  return `${d.toLocaleDateString([], dateOpts)} · ${d.toLocaleTimeString([], timeOpts)}`;
}

function relativeStatus(iso: string): { label: string; tone: "overdue" | "soon" | "future" } {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.round((t - now) / 60_000);

  if (diffMin < -60 * 24) {
    const days = Math.round(-diffMin / (60 * 24));
    return { label: `Overdue ${days}d`, tone: "overdue" };
  }
  if (diffMin < -60) return { label: `Overdue ${Math.round(-diffMin / 60)}h`, tone: "overdue" };
  if (diffMin < 0) return { label: `Overdue ${-diffMin}m`, tone: "overdue" };
  if (diffMin < 60) return { label: `In ${diffMin || 0}m`, tone: "soon" };
  if (diffMin < 60 * 24) return { label: `In ${Math.round(diffMin / 60)}h`, tone: "soon" };
  return { label: `In ${Math.round(diffMin / (60 * 24))}d`, tone: "future" };
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }
}

type NavWithShare = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
  canShare?: (data: { text?: string; files?: File[] }) => boolean;
};

async function buildShareFiles(
  media: { id: string; mimeType: string; url: string | null }[],
  fallbackName: string,
): Promise<File[]> {
  const files: File[] = [];
  for (const m of media) {
    if (!m.url) continue;
    try {
      const res = await fetch(m.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = m.mimeType.split("/")[1] ?? "bin";
      const name = `${fallbackName}-${m.id}.${ext}`;
      files.push(new File([blob], name, { type: m.mimeType }));
    } catch {
      // skip media that fails to fetch
    }
  }
  return files;
}

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/**
 * Share-to-FB strategy:
 *
 * - **iOS / Android (Web Share with files):** native share sheet — FB app
 *   receives the media and caption in one tap. This is the only path where
 *   FB's composer pre-fills automatically.
 *
 * - **Desktop (Mac/Win/Linux):** Facebook offers no public URL or API to
 *   pre-fill a photo/video composer from the outside. `sharer.php` only
 *   creates link-share posts, and the `fb://composer` deep link is iOS-only.
 *   So we do the next-most-useful thing: open facebook.com in a new tab,
 *   copy the caption to the clipboard, and download every media file to the
 *   user's Downloads folder. They paste the caption, drag the media in, post.
 *
 * Returns which path ran so the UI can show the right confirmation hint.
 */
async function shareToFb(opts: {
  body: string;
  media: { id: string; mimeType: string; url: string | null }[];
  postId: string;
}): Promise<"shared" | "desktop" | "blocked"> {
  const nav = navigator as NavWithShare;
  const fallbackName = `gil-${opts.postId}`;

  // Mobile path: Web Share API with files + text → iOS share sheet → FB app.
  // UA-sniff so macOS Safari (which also exposes navigator.share but won't
  // accept files in any useful way) goes straight to the desktop path.
  if (isMobileUserAgent() && nav.share && nav.canShare) {
    const files = await buildShareFiles(opts.media, fallbackName);
    const payload = { text: opts.body, files };
    if (files.length > 0 && nav.canShare(payload)) {
      try {
        await nav.share(payload);
        return "shared";
      } catch {
        return "shared";
      }
    }
  }

  // Desktop. Open the FB tab synchronously inside the user-gesture window so
  // popup blockers leave it alone, then do the slow async work afterwards.
  const fbTab = window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
  await copyTextToClipboard(opts.body);

  // Download every media file to the user's Downloads folder so they can
  // drag-and-drop into the FB composer. Browsers happily run multiple
  // .download anchor clicks back-to-back when triggered from a single gesture.
  for (const m of opts.media) {
    if (!m.url) continue;
    try {
      const res = await fetch(m.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = m.mimeType.split("/")[1] ?? "bin";
      triggerBrowserDownload(blob, `${fallbackName}-${m.id}.${ext}`);
    } catch {
      // Skip a single failed media file rather than aborting the whole share.
    }
  }

  return fbTab ? "desktop" : "blocked";
}

export function ManualFbQueueClient({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [refreshing, setRefreshing] = useState(false);

  const overdueCount = useMemo(
    () => items.filter((i) => new Date(i.scheduledAt).getTime() < Date.now()).length,
    [items],
  );

  const refetchQueue = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/manual-fb-queue", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: QueueItem[] };
        setItems(data.items);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  function removeQueueItem(postId: string) {
    setItems((prev) => prev.filter((i) => i.postId !== postId));
  }

  const subtitle =
    items.length === 0
      ? "Nothing waiting — you're caught up. Posts marked as posted move to Published."
      : overdueCount > 0
        ? `${overdueCount} overdue · ${items.length} total`
        : `${items.length} waiting`;

  return (
    <>
      <PostingHubTabs />
      <PageHeader
        title="Manual FB"
        subtitle={subtitle}
        actions={
          <button
            type="button"
            onClick={() => void refetchQueue()}
            disabled={refreshing}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50"
            aria-label="Refresh"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </button>
        }
      />

      {items.length === 0 ? (
        <EmptyQueue />
      ) : (
        <ul className="mx-auto w-full max-w-2xl space-y-2.5">
          {items.map((item) => (
            <QueueRow
              key={item.slotId ?? `post:${item.postId}`}
              item={item}
              onCleared={() => removeQueueItem(item.postId)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function EmptyQueue() {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
        <Check className="h-6 w-6 text-emerald-700" strokeWidth={2.5} />
      </div>
      <h2 className="text-base font-semibold text-gray-900">Queue&apos;s clear</h2>
      <p className="mt-1 text-[13px] text-gray-500">
        No scheduled posts are waiting to be cross-posted to Facebook personal.
      </p>
    </div>
  );
}

function QueueRow({ item, onCleared }: { item: QueueItem; onCleared: () => void }) {
  const poster = posterUrl(item.media);
  const status = relativeStatus(item.scheduledAt);
  const time = formatScheduled(item.scheduledAt);

  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  // Two-step "Mark posted": first click opens an inline URL field; second
  // click on the same button submits with whatever's in the field. Empty URL
  // is allowed (records the publish but the activity row won't have a link).
  const [showUrlField, setShowUrlField] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  async function handleShare() {
    if (sharing) return;
    setSharing(true);
    setShareError(null);
    setShareHint(null);
    try {
      const result = await shareToFb({
        body: item.body,
        media: item.media,
        postId: item.postId,
      });
      if (result === "desktop") {
        const mediaCount = item.media.length;
        const mediaPhrase =
          mediaCount === 0
            ? ""
            : mediaCount === 1
              ? " · media downloaded — drag it into the composer"
              : ` · ${mediaCount} files downloaded — drag them in`;
        setShareHint(`Caption copied${mediaPhrase}`);
        setTimeout(() => setShareHint(null), 8000);
      } else if (result === "blocked") {
        setShareError("Browser blocked the new Facebook tab — allow popups and try again.");
      }
    } catch {
      setShareError("Couldn't open share sheet");
    } finally {
      setSharing(false);
    }
  }

  async function handleCopy() {
    const ok = await copyTextToClipboard(item.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  async function clearWithStatus(
    status: "PUBLISHED" | "CANCELLED",
    platformUrl?: string,
  ) {
    if (marking || skipping || cleared) return;
    setActionError(null);
    if (status === "PUBLISHED") setMarking(true);
    else setSkipping(true);
    try {
      const body: Record<string, unknown> = { platform: "FACEBOOK", status };
      if (platformUrl) body.platformUrl = platformUrl;
      const res = await fetch(`/api/posts/${item.postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data?.error ?? "Action failed");
        return;
      }
      setCleared(true);
      clearTimer.current = setTimeout(onCleared, 550);
    } catch {
      setActionError("Network error");
    } finally {
      setMarking(false);
      setSkipping(false);
    }
  }

  function handleMarkPostedClick() {
    if (marking || skipping || cleared) return;
    if (!showUrlField) {
      setShowUrlField(true);
      return;
    }
    const url = pastedUrl.trim();
    void clearWithStatus("PUBLISHED", url || undefined);
  }

  const toneRing =
    status.tone === "overdue"
      ? "border-red-200 bg-red-50/50"
      : status.tone === "soon"
        ? "border-amber-200 bg-amber-50/40"
        : "border-gray-200 bg-white";

  const tonePill =
    status.tone === "overdue"
      ? "bg-red-100 text-red-700"
      : status.tone === "soon"
        ? "bg-amber-100 text-amber-800"
        : "bg-gray-100 text-gray-600";

  const helperHref = item.slotId ? `/admin/m/${item.postId}?slot=${item.slotId}` : `/admin/m/${item.postId}`;

  return (
    <li
      className={`overflow-hidden rounded-2xl border shadow-sm transition-all ${toneRing} ${
        cleared ? "translate-x-2 opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex gap-3 p-3">
        <Link
          href={helperHref}
          className="relative block h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-200"
          aria-label="Open manual posting helper"
        >
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
              No media
            </div>
          )}
          {item.media.some((m) => m.mimeType.startsWith("video/")) && (
            <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[9px] font-semibold uppercase tracking-wide text-white">
              Video
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tonePill}`}
              >
                <Clock className="h-3 w-3" />
                {status.label}
              </span>
              <span className="truncate text-[11px] text-gray-500">{time}</span>
              {item.reminderSentAt && (
                <span className="shrink-0 text-[11px] text-gray-400" title="Push reminder fired">
                  · reminded
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setConfirmRemove((c) => !c)}
              disabled={skipping || marking}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 active:bg-gray-200 disabled:opacity-40 ${
                confirmRemove ? "bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700" : ""
              }`}
              aria-label="Remove from queue"
              title="Remove from queue"
            >
              {confirmRemove ? <Ban className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-snug text-gray-800">
            {item.body || <span className="italic text-gray-400">No caption.</span>}
          </p>
        </div>
      </div>

      {confirmRemove && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-red-100 bg-red-50/60 px-3 py-2">
          <span className="min-w-0 truncate text-[12px] text-red-800">
            Remove from queue without posting?
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setConfirmRemove(false)}
              className="rounded-md px-2 py-1 text-[12px] font-medium text-gray-600 hover:bg-white/70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmRemove(false);
                void clearWithStatus("CANCELLED");
              }}
              disabled={skipping}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-60"
            >
              {skipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
              Remove
            </button>
          </div>
        </div>
      )}

      {/* Primary: Share to FB */}
      <button
        type="button"
        onClick={handleShare}
        disabled={sharing || cleared}
        className="flex w-full items-center justify-center gap-1.5 border-t border-black/[0.04] bg-[#1877F2] py-3 text-[14px] font-semibold text-white hover:bg-[#166fe5] active:bg-[#155ec1] disabled:opacity-70"
      >
        {sharing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing share…
          </>
        ) : (
          <>
            <Share2 className="h-4 w-4" strokeWidth={2.5} />
            Share to Facebook
          </>
        )}
      </button>

      {showUrlField && (
        <div className="flex flex-col gap-1.5 border-t border-black/[0.04] bg-blue-50/40 px-3 py-2">
          <label className="text-[11px] font-medium text-gray-600">
            Paste the FB post URL so it links from the post page
          </label>
          <div className="flex items-center gap-1.5">
            <input
              type="url"
              inputMode="url"
              autoFocus
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
              placeholder="https://www.facebook.com/…"
              className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowUrlField(false);
                setPastedUrl("");
              }}
              className="shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-white"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-gray-500">
            Optional — leave blank to mark posted without a link.
          </p>
        </div>
      )}

      {/* Secondary: every helper action accessible from the list */}
      <div className="flex items-stretch border-t border-black/[0.04] bg-white/60">
        <button
          type="button"
          onClick={handleMarkPostedClick}
          disabled={marking || cleared}
          className="flex flex-1 min-w-0 items-center justify-center gap-1 py-2.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40"
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          <span className="truncate">{showUrlField ? "Save" : "Mark posted"}</span>
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={!item.body}
          className="flex flex-1 min-w-0 items-center justify-center gap-1 border-l border-black/[0.04] py-2.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
              <span className="truncate">Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              <span className="truncate">Copy</span>
            </>
          )}
        </button>
        <Link
          href={helperHref}
          className="flex flex-1 min-w-0 items-center justify-center gap-1 border-l border-black/[0.04] py-2.5 text-[12px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100"
        >
          <span className="truncate">Helper</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
      </div>

      {shareHint && !shareError && !actionError && (
        <p className="border-t border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] break-words text-emerald-800">
          {shareHint}
        </p>
      )}
      {(shareError || actionError) && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] break-words text-red-700">
          {shareError ?? actionError}
        </p>
      )}
    </li>
  );
}

