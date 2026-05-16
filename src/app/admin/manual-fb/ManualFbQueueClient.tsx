"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  Check,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import { SiFacebook } from "react-icons/si";

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

export type HistoryItem = {
  publishRecordId: string;
  postId: string;
  body: string;
  recordedAt: string;
  status: "PUBLISHED" | "CANCELLED";
  media: { id: string; mimeType: string; url: string | null }[];
};

type Tab = "queue" | "history";

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

function relativeAgo(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const h = Math.round(diffMin / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
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

/**
 * Tries Web Share API with media + caption, falls back progressively. Returns
 * "shared" if the share sheet was successfully opened (we can't tell whether
 * the user actually completed the post inside FB, so this only signals
 * "intent to share").
 */
async function shareToFb(opts: {
  body: string;
  media: { id: string; mimeType: string; url: string | null }[];
  postId: string;
}): Promise<"shared" | "copied" | "unsupported"> {
  const nav = navigator as NavWithShare;
  const fallbackName = `gil-${opts.postId}`;

  if (nav.share) {
    const files = await buildShareFiles(opts.media, fallbackName);
    const payload = { text: opts.body, files };
    if (files.length > 0 && nav.canShare?.(payload)) {
      try {
        await nav.share(payload);
        return "shared";
      } catch {
        // user cancelled — treat as "no-op" (don't fall through to copy)
        return "shared";
      }
    }
    const textOnly = { text: opts.body };
    if (nav.canShare?.(textOnly) ?? true) {
      try {
        await nav.share(textOnly);
        return "shared";
      } catch {
        return "shared";
      }
    }
  }

  // Fallback: copy caption, then deep-link into FB composer.
  await copyTextToClipboard(opts.body);
  window.location.href = "fb://composer";
  return "copied";
}

export function ManualFbQueueClient({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [tab, setTab] = useState<Tab>("queue");
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

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

  const refetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/admin/manual-fb-queue/history", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items: HistoryItem[] };
        setHistory(data.items);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Lazy-load history on first switch.
  useEffect(() => {
    if (tab === "history" && history === null && !historyLoading) {
      void refetchHistory();
    }
  }, [tab, history, historyLoading, refetchHistory]);

  const refresh = tab === "queue" ? refetchQueue : refetchHistory;
  const refreshingNow = tab === "queue" ? refreshing : historyLoading;

  function removeQueueItem(postId: string) {
    setItems((prev) => prev.filter((i) => i.postId !== postId));
  }

  function removeHistoryItem(postId: string) {
    setHistory((prev) => (prev ? prev.filter((i) => i.postId !== postId) : prev));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 py-2 md:py-0">
      <header className="flex items-center justify-between gap-3 px-1 pt-1 md:pt-0">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <SiFacebook className="h-5 w-5 shrink-0 text-[#1877F2]" />
            <span className="truncate">Manual FB queue</span>
          </h1>
          <p className="mt-0.5 truncate text-[13px] text-gray-500">
            {tab === "queue"
              ? items.length === 0
                ? "Nothing waiting — you're caught up."
                : overdueCount > 0
                  ? `${overdueCount} overdue · ${items.length} total`
                  : `${items.length} scheduled`
              : history === null
                ? "Loading history…"
                : history.length === 0
                  ? "No recent activity."
                  : `${history.length} cleared in the last 30 days`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={refreshingNow}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50"
          aria-label="Refresh"
        >
          {refreshingNow ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </header>

      <Tabs tab={tab} setTab={setTab} queueCount={items.length} historyCount={history?.length ?? null} />

      {tab === "queue" ? (
        items.length === 0 ? (
          <EmptyQueue />
        ) : (
          <ul className="space-y-2.5">
            {items.map((item) => (
              <QueueRow
                key={item.slotId ?? `post:${item.postId}`}
                item={item}
                onCleared={() => removeQueueItem(item.postId)}
              />
            ))}
          </ul>
        )
      ) : history === null || historyLoading ? (
        <HistorySkeleton />
      ) : history.length === 0 ? (
        <EmptyHistory />
      ) : (
        <ul className="space-y-2.5">
          {history.map((item) => (
            <HistoryRow
              key={item.publishRecordId}
              item={item}
              onUndone={() => {
                removeHistoryItem(item.postId);
                void refetchQueue();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Tabs({
  tab,
  setTab,
  queueCount,
  historyCount,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  queueCount: number;
  historyCount: number | null;
}) {
  return (
    <div className="flex w-full gap-1 rounded-xl bg-gray-100 p-1 text-[13px] font-medium">
      <button
        type="button"
        onClick={() => setTab("queue")}
        className={`flex flex-1 min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
          tab === "queue" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <span className="truncate">Queue</span>
        <span className="rounded-full bg-gray-200/80 px-1.5 text-[11px] text-gray-700">{queueCount}</span>
      </button>
      <button
        type="button"
        onClick={() => setTab("history")}
        className={`flex flex-1 min-w-0 items-center justify-center gap-1 rounded-lg px-2 py-1.5 transition-colors ${
          tab === "history" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
        }`}
      >
        <span className="truncate">History</span>
        {historyCount !== null && (
          <span className="rounded-full bg-gray-200/80 px-1.5 text-[11px] text-gray-700">{historyCount}</span>
        )}
      </button>
    </div>
  );
}

function EmptyQueue() {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
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

function EmptyHistory() {
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
      <h2 className="text-base font-semibold text-gray-900">No history yet</h2>
      <p className="mt-1 text-[13px] text-gray-500">
        Items you mark as posted or skip will appear here so you can undo them.
      </p>
    </div>
  );
}

function HistorySkeleton() {
  return (
    <div className="mt-4 flex items-center justify-center py-8 text-gray-500">
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      <span className="text-[13px]">Loading history…</span>
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
  const [marking, setMarking] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
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
    try {
      const result = await shareToFb({
        body: item.body,
        media: item.media,
        postId: item.postId,
      });
      if (result === "copied") {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
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

  async function clearWithStatus(status: "PUBLISHED" | "CANCELLED") {
    if (marking || skipping || cleared) return;
    setActionError(null);
    if (status === "PUBLISHED") setMarking(true);
    else setSkipping(true);
    try {
      const res = await fetch(`/api/posts/${item.postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "FACEBOOK", status }),
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

      {/* Secondary: every helper action accessible from the list */}
      <div className="flex items-stretch border-t border-black/[0.04] bg-white/60">
        <button
          type="button"
          onClick={() => void clearWithStatus("PUBLISHED")}
          disabled={marking || cleared}
          className="flex flex-1 min-w-0 items-center justify-center gap-1 py-2.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-50 active:bg-emerald-100 disabled:opacity-50"
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          <span className="truncate">Posted</span>
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
        {item.platformUrl ? (
          <a
            href={item.platformUrl}
            target="_blank"
            rel="noreferrer"
            className="flex w-10 shrink-0 items-center justify-center border-l border-black/[0.04] text-gray-500 hover:bg-gray-50 hover:text-gray-700"
            title="Original on Facebook"
            aria-label="Original on Facebook"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>

      {(shareError || actionError) && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
          {shareError ?? actionError}
        </p>
      )}
    </li>
  );
}

function HistoryRow({ item, onUndone }: { item: HistoryItem; onUndone: () => void }) {
  const poster = posterUrl(item.media);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (removeTimer.current) clearTimeout(removeTimer.current);
    };
  }, []);

  async function handleUndo() {
    if (undoing || undone) return;
    setUndoing(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${item.postId}/manual-publish?platform=FACEBOOK`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Couldn't undo");
        return;
      }
      setUndone(true);
      removeTimer.current = setTimeout(onUndone, 450);
    } catch {
      setError("Network error");
    } finally {
      setUndoing(false);
    }
  }

  const isPosted = item.status === "PUBLISHED";
  const statusPill = isPosted
    ? "bg-emerald-100 text-emerald-800"
    : "bg-gray-200 text-gray-700";
  const statusIcon = isPosted ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Ban className="h-3 w-3" />;
  const statusLabel = isPosted ? "Posted" : "Skipped";

  return (
    <li
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all ${
        undone ? "translate-x-2 opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex gap-3 p-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-gray-200">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] font-medium text-gray-400">
              No media
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusPill}`}
            >
              {statusIcon}
              {statusLabel}
            </span>
            <span className="truncate text-[11px] text-gray-500">{relativeAgo(item.recordedAt)}</span>
          </div>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-snug text-gray-800">
            {item.body || <span className="italic text-gray-400">No caption.</span>}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={handleUndo}
        disabled={undoing || undone}
        className="flex w-full items-center justify-center gap-1.5 border-t border-black/[0.04] bg-white/60 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-60"
      >
        {undoing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : undone ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
        ) : (
          <RotateCcw className="h-3.5 w-3.5" />
        )}
        {undone ? "Restored to queue" : isPosted ? "Unmark posted" : "Restore to queue"}
      </button>
      {error && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{error}</p>
      )}
    </li>
  );
}
