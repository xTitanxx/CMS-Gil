"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  Clock,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import { SiSubstack } from "react-icons/si";
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
  publishRecordId: string;
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

export function ManualSubstackQueueClient() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [publicationUrl, setPublicationUrl] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/substack-settings")
      .then((r) => r.json())
      .then((d: { publicationUrl?: string | null }) =>
        setPublicationUrl(d.publicationUrl ?? null),
      )
      .catch(() => {});
  }, []);

  const overdueCount = useMemo(
    () => items.filter((i) => new Date(i.scheduledAt).getTime() < Date.now()).length,
    [items],
  );

  const refetchQueue = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/admin/manual-substack-queue", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: QueueItem[] };
        setItems(data.items);
      }
    } finally {
      setRefreshing(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refetchQueue();
  }, [refetchQueue]);

  function removeQueueItem(publishRecordId: string) {
    setItems((prev) => prev.filter((i) => i.publishRecordId !== publishRecordId));
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

  const subtitle = !loaded
    ? "Loading…"
    : items.length === 0
      ? "Nothing waiting — you're caught up."
      : overdueCount > 0
        ? `${overdueCount} overdue · ${items.length} total`
        : `${items.length} waiting`;

  return (
    <>
      <PostingHubTabs />
      <PostingListView<QueueItem>
        title="Manual Substack"
        subtitle={subtitle}
        items={items}
        onRefresh={refetchQueue}
        refreshing={refreshing}
        itemNoun={{ singular: "post", plural: "posts" }}
        getId={(i) => i.slotId ?? `post:${i.publishRecordId}`}
        searchKeys={(i) => [i.body]}
        sortOptions={sortOptions}
        filters={filters}
        emptyState={<EmptyQueue />}
        renderRow={(item) => (
          <QueueRow
            item={item}
            publicationUrl={publicationUrl}
            onCleared={() => removeQueueItem(item.publishRecordId)}
          />
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
      <p className="mt-1 break-words text-[13px] text-gray-500">
        No scheduled posts are waiting to be published to Substack.
      </p>
    </div>
  );
}

function QueueRow({
  item,
  publicationUrl,
  onCleared,
}: {
  item: QueueItem;
  publicationUrl: string | null;
  onCleared: () => void;
}) {
  const poster = posterUrl(item.media);
  const status = relativeStatus(item.scheduledAt);
  const time = formatScheduled(item.scheduledAt);
  const hasVideo = item.media.some((m) => m.mimeType.startsWith("video/"));
  const imageMedia = useMemo(
    () => item.media.filter((m) => m.mimeType.startsWith("image/") && m.url),
    [item.media],
  );

  const [copied, setCopied] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [openHint, setOpenHint] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  // Two-step "Mark published": first click opens the permalink input row;
  // the second click (now labelled Save) submits with whatever's there. The
  // permalink is required server-side, so we keep the button disabled until
  // a non-empty value is present once the field is visible.
  const [showUrlField, setShowUrlField] = useState(false);
  const [pastedUrl, setPastedUrl] = useState("");
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  async function handleOpenSubstack() {
    if (opening) return;
    setOpening(true);
    setOpenError(null);
    setOpenHint(null);
    try {
      const ok = await copyTextToClipboard(item.body);
      if (!publicationUrl) {
        setOpenError(
          "Set your Substack publication URL in /admin/connections first.",
        );
        return;
      }
      const tab = window.open(
        `${publicationUrl}/publish/post`,
        "_blank",
        "noopener,noreferrer",
      );
      if (!tab) {
        setOpenError(
          "Browser blocked the new Substack tab — allow popups and try again.",
        );
        return;
      }
      setOpenHint(
        ok
          ? "Body copied — paste it into the Substack editor."
          : "Substack editor opened — copy the body manually.",
      );
      setTimeout(() => setOpenHint(null), 6000);
    } catch {
      setOpenError("Couldn't open Substack.");
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

  async function markPublished(permalink: string) {
    if (marking || skipping || cleared) return;
    setActionError(null);
    setMarking(true);
    try {
      const res = await fetch("/api/admin/manual-substack-queue/mark-published", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishRecordId: item.publishRecordId, permalink }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data?.error ?? "Action failed");
        return;
      }
      setCleared(true);
      clearTimer.current = setTimeout(onCleared, 550);
    } catch {
      setActionError("Network error");
    } finally {
      setMarking(false);
    }
  }

  async function cancelPublish() {
    if (marking || skipping || cleared) return;
    setActionError(null);
    setSkipping(true);
    try {
      const res = await fetch(`/api/posts/${item.postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "SUBSTACK", status: "CANCELLED" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setActionError(data?.error ?? "Action failed");
        return;
      }
      setCleared(true);
      clearTimer.current = setTimeout(onCleared, 550);
    } catch {
      setActionError("Network error");
    } finally {
      setSkipping(false);
    }
  }

  function handleMarkPublishedClick() {
    if (marking || skipping || cleared) return;
    if (!showUrlField) {
      setShowUrlField(true);
      return;
    }
    const url = pastedUrl.trim();
    if (!url) {
      setActionError("Paste the Substack permalink before saving.");
      return;
    }
    void markPublished(url);
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
    ? `/admin/m/${item.postId}?slot=${item.slotId}&from=/admin/manual-substack`
    : `/admin/m/${item.postId}?from=/admin/manual-substack`;

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

      {imageMedia.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-black/[0.04] bg-gray-50/60 px-3 py-2 md:px-4">
          {imageMedia.map((m) => (
            <div key={m.id} className="flex w-20 min-w-0 flex-col items-center gap-1">
              <div className="relative h-16 w-20 overflow-hidden rounded-md bg-gray-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url!}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
              <a
                href={m.url!}
                download
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[11px] font-medium text-blue-700 hover:underline"
                title="Download to upload into Substack"
              >
                <Download className="h-3 w-3" />
                <span className="truncate">Download</span>
              </a>
            </div>
          ))}
        </div>
      )}

      {confirmRemove && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-red-100 bg-red-50/60 px-3 py-2">
          <span className="min-w-0 break-words text-[12px] text-red-800">
            Remove from queue without publishing?
          </span>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
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
                void cancelPublish();
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
          <label className="break-words text-[11px] font-medium text-gray-600">
            Paste the Substack permalink (required to mark published)
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              type="url"
              inputMode="url"
              autoFocus
              value={pastedUrl}
              onChange={(e) => setPastedUrl(e.target.value)}
              placeholder={
                publicationUrl ? `${publicationUrl}/p/…` : "https://yourname.substack.com/p/…"
              }
              className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[12px] text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                setShowUrlField(false);
                setPastedUrl("");
                setActionError(null);
              }}
              className="shrink-0 rounded-md px-2 py-1.5 text-[12px] font-medium text-gray-500 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Action row: Copy body (secondary), Open Substack (primary CTA),
          Mark published (primary blue, two-step with permalink paste). */}
      <div className="flex flex-wrap items-stretch border-t border-black/[0.04] bg-white/60">
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
          label={copied ? "Copied" : "Copy body"}
          title="Copy the body to the clipboard"
        />
        <RowActionButton
          onClick={handleOpenSubstack}
          disabled={opening}
          icon={
            opening ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <SiSubstack className="h-3.5 w-3.5 text-[#FF6719]" />
            )
          }
          label="Copy body & open Substack"
          title={
            publicationUrl
              ? "Copy the body and open the Substack editor in a new tab"
              : "Set your Substack publication URL in /admin/connections first"
          }
        />
        <button
          type="button"
          onClick={handleMarkPublishedClick}
          disabled={marking || cleared}
          className="flex min-w-0 flex-[1.3] items-center justify-center gap-1 border-l border-black/[0.04] bg-blue-600 py-2.5 text-[12px] font-semibold text-white hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60"
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          <span className="truncate">{showUrlField ? "Save" : "Mark published"}</span>
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
      className="flex min-w-0 flex-1 items-center justify-center gap-1 border-l border-black/[0.04] py-2.5 text-[12px] font-medium text-gray-700 first:border-l-0 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40"
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

