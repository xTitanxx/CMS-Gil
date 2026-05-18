"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { PostingHubTabs } from "../_shared/PostingHubTabs";
import {
  PostingListView,
  type PostingFilterDef,
  type PostingSortDef,
} from "../_shared/PostingListView";

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

type Tone = "overdue" | "soon" | "future";

function relativeStatus(iso: string): { label: string; tone: Tone } {
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
 * Open Facebook so the user can compose a new post.
 *
 * Reality check: Facebook offers no public URL that pre-fills a personal-
 * profile composer with text + media from outside FB. `sharer.php` only does
 * link shares; `fb://composer` is iOS-app-only with unreliable text pre-fill.
 * So the best we can do is split the workflow into honest, single-purpose
 * actions and let the user assemble the post:
 *
 * - **Mobile (Web Share API with files):** native share sheet — the FB app
 *   receives the media + caption in one tap. This is the one path where the
 *   composer pre-fills for free.
 * - **Desktop:** open facebook.com in a new tab (the composer is the first
 *   thing on the feed). Copying the caption and downloading media live behind
 *   dedicated buttons so the user can prep before clicking through.
 */
async function openFacebook(opts: {
  body: string;
  media: { id: string; mimeType: string; url: string | null }[];
  postId: string;
}): Promise<"shared" | "opened" | "blocked"> {
  const nav = navigator as NavWithShare;
  const fallbackName = `gil-${opts.postId}`;

  // Mobile path: Web Share API with files + text → native share sheet → FB app.
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

  // Desktop: just open facebook.com in a new tab. Open synchronously so popup
  // blockers leave it alone.
  const fbTab = window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
  return fbTab ? "opened" : "blocked";
}

/** Download every media file attached to the post to the user's Downloads
 *  folder. Used so the user can drag-and-drop into the FB composer. */
async function downloadAllMedia(opts: {
  media: { id: string; mimeType: string; url: string | null }[];
  postId: string;
}): Promise<number> {
  const fallbackName = `gil-${opts.postId}`;
  let count = 0;
  for (const m of opts.media) {
    if (!m.url) continue;
    try {
      const res = await fetch(m.url);
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = m.mimeType.split("/")[1] ?? "bin";
      triggerBrowserDownload(blob, `${fallbackName}-${m.id}.${ext}`);
      count++;
    } catch {
      // Skip a single failed media file rather than aborting the whole batch.
    }
  }
  return count;
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

  const sortOptions = useMemo<PostingSortDef<QueueItem>[]>(
    () => [
      {
        value: "due_asc",
        label: "Most overdue first",
        compare: (a, b) =>
          new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
      },
      {
        value: "due_desc",
        label: "Furthest out first",
        compare: (a, b) =>
          new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime(),
      },
    ],
    [],
  );

  const filters = useMemo<PostingFilterDef<QueueItem>[]>(
    () => [
      {
        id: "tone",
        title: "Timing",
        options: [
          { value: "overdue", label: "Overdue" },
          { value: "soon", label: "Due soon (< 24h)" },
          { value: "future", label: "Further out" },
        ],
        valueFor: (i) => relativeStatus(i.scheduledAt).tone,
      },
      {
        id: "source",
        title: "Source",
        options: [
          { value: "planner", label: "Weekly planner" },
          { value: "adhoc", label: "Ad-hoc / Post now" },
        ],
        valueFor: (i) => (i.slotId == null ? "adhoc" : "planner"),
      },
      {
        id: "media",
        title: "Media",
        options: [
          { value: "with", label: "Has media" },
          { value: "none", label: "Caption only" },
        ],
        valueFor: (i) => (i.media.length > 0 ? "with" : "none"),
      },
    ],
    [],
  );

  const subtitle =
    items.length === 0
      ? "Nothing waiting — you're caught up."
      : overdueCount > 0
        ? `${overdueCount} overdue · ${items.length} total`
        : `${items.length} waiting`;

  return (
    <>
      <PostingHubTabs />
      <PostingListView<QueueItem>
        title="Manual FB"
        subtitle={subtitle}
        items={items}
        onRefresh={refetchQueue}
        refreshing={refreshing}
        itemNoun={{ singular: "post", plural: "posts" }}
        getId={(i) => i.slotId ?? `post:${i.postId}`}
        searchKeys={(i) => [i.body]}
        sortOptions={sortOptions}
        filters={filters}
        emptyState={<EmptyQueue />}
        renderRow={(item) => (
          <QueueRow item={item} onCleared={() => removeQueueItem(item.postId)} />
        )}
      />
    </>
  );
}

function EmptyQueue() {
  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
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
  const hasVideo = item.media.some((m) => m.mimeType.startsWith("video/"));
  const hasMedia = item.media.length > 0;
  const mobile = isMobileUserAgent();

  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openHint, setOpenHint] = useState<string | null>(null);
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

  async function handleOpenFb() {
    if (opening) return;
    setOpening(true);
    setOpenError(null);
    setOpenHint(null);
    try {
      const result = await openFacebook({
        body: item.body,
        media: item.media,
        postId: item.postId,
      });
      if (result === "opened") {
        setOpenHint("Facebook opened in a new tab — the composer is at the top of the feed.");
        setTimeout(() => setOpenHint(null), 6000);
      } else if (result === "blocked") {
        setOpenError("Browser blocked the new Facebook tab — allow popups and try again.");
      }
    } catch {
      setOpenError("Couldn't open Facebook.");
    } finally {
      setOpening(false);
    }
  }

  async function handleCopy() {
    const ok = await copyTextToClipboard(item.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  async function handleDownload() {
    if (downloading || !hasMedia) return;
    setDownloading(true);
    setOpenError(null);
    setOpenHint(null);
    try {
      const n = await downloadAllMedia({ media: item.media, postId: item.postId });
      if (n === 0) {
        setOpenError("No media could be downloaded.");
      } else {
        setOpenHint(
          n === 1
            ? "Media downloaded — drag it into the FB composer."
            : `${n} files downloaded — drag them into the FB composer.`,
        );
        setTimeout(() => setOpenHint(null), 6000);
      }
    } catch {
      setOpenError("Couldn't download media.");
    } finally {
      setDownloading(false);
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

  const toneHeading =
    status.tone === "overdue"
      ? "text-red-700"
      : status.tone === "soon"
        ? "text-amber-800"
        : "text-gray-700";

  const toneTime =
    status.tone === "overdue"
      ? "text-red-900"
      : status.tone === "soon"
        ? "text-amber-900"
        : "text-gray-900";

  const helperHref = item.slotId
    ? `/admin/m/${item.postId}?slot=${item.slotId}&from=/admin/manual-fb`
    : `/admin/m/${item.postId}?from=/admin/manual-fb`;

  // Standard hub row chrome — matches ScheduledRow / PublishedPostRow:
  // rounded-2xl white card with subtle hover. Tone lives on the status pill,
  // not as a row-wide outline.
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ring-1 ring-black/[0.02] transition-all hover:border-gray-200 hover:shadow-md ${
        cleared ? "translate-x-2 opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex items-center gap-3 p-3 md:gap-4 md:p-4">
        <Link
          href={helperHref}
          className="relative block h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-20 md:w-20"
          aria-label="Open manual posting helper"
        >
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <ImageIcon className="h-6 w-6 text-gray-300" />
            </div>
          )}
          {hasVideo && (
            <div
              className="pointer-events-none absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5"
              title="Video"
            >
              <Video className="h-3 w-3 text-white" />
            </div>
          )}
          {hasVideo && (
            <div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              aria-hidden
            >
              <Play className="h-5 w-5 text-white/90 drop-shadow" fill="currentColor" />
            </div>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <div
                className={`flex min-w-0 items-center gap-1.5 text-[15px] font-bold leading-tight ${toneHeading}`}
              >
                <Clock className="h-4 w-4 shrink-0" />
                <span className="truncate">{status.label}</span>
              </div>
              <p
                className={`mt-0.5 break-words text-[13px] font-medium leading-snug ${toneTime}`}
              >
                {time}
              </p>
              {item.reminderSentAt && (
                <p className="mt-1 text-[11px] text-gray-400" title="Push reminder fired">
                  reminded
                </p>
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
          {item.body ? (
            <p className="mt-1 line-clamp-2 break-words text-sm text-gray-700">{item.body}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
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

      {showUrlField && (
        <div className="flex flex-col gap-1.5 border-t border-black/[0.04] bg-blue-50/40 px-3 py-2 md:px-4">
          <label className="text-[11px] font-medium text-gray-600">
            Paste the FB post URL so the post page can link to it (optional)
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
        </div>
      )}

      {/* Action row: 3 secondaries on the left (Copy → Download → Open FB),
          Mark posted (primary blue) on the right. Order matches the workflow:
          grab the caption, grab the media, open Facebook, then come back and
          confirm it's posted. */}
      <div className="flex items-stretch border-t border-black/[0.04] bg-white/60">
        <RowActionButton
          onClick={handleCopy}
          disabled={!item.body}
          icon={
            copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )
          }
          label={copied ? "Copied" : "Copy"}
          title="Copy the caption to the clipboard"
        />
        <RowActionButton
          onClick={handleDownload}
          disabled={!hasMedia || downloading}
          icon={
            downloading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )
          }
          label={downloading ? "Saving…" : "Download"}
          title={
            hasMedia
              ? "Save all media to your Downloads folder so you can drag it into FB"
              : "No media on this post"
          }
        />
        <RowActionButton
          onClick={handleOpenFb}
          disabled={opening}
          icon={
            opening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : mobile ? (
              <SiFacebook className="h-3.5 w-3.5 text-[#1877F2]" />
            ) : (
              <ExternalLink className="h-3.5 w-3.5" />
            )
          }
          label={mobile ? "Share to FB" : "Open FB"}
          title={
            mobile
              ? "Open the share sheet so the FB app gets the caption and media"
              : "Open facebook.com in a new tab — the composer is at the top of the feed"
          }
        />
        <button
          type="button"
          onClick={handleMarkPostedClick}
          disabled={marking || cleared}
          className="flex flex-[1.3] min-w-0 items-center justify-center gap-1 border-l border-black/[0.04] bg-blue-600 py-2.5 text-[12px] font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          <span className="truncate">{showUrlField ? "Save" : "Mark posted"}</span>
        </button>
      </div>

      {openHint && !openError && !actionError && (
        <p className="border-t border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[11px] break-words text-emerald-800">
          {openHint}
        </p>
      )}
      {(openError || actionError) && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] break-words text-red-700">
          {openError ?? actionError}
        </p>
      )}
    </div>
  );
}

/** Compact secondary action used in the QueueRow footer. Equal-flex so the
 *  row balances; truncates labels on tight viewports. */
function RowActionButton({
  onClick,
  disabled,
  icon,
  label,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex flex-1 min-w-0 items-center justify-center gap-1 border-l border-black/[0.04] py-2.5 text-[12px] font-medium text-gray-700 first:border-l-0 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}
