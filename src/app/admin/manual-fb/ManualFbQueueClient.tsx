"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Clock,
  Copy,
  Loader2,
  RefreshCw,
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

function posterUrl(item: QueueItem): string | null {
  const first = item.media[0];
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

export function ManualFbQueueClient({ initialItems }: { initialItems: QueueItem[] }) {
  const [items, setItems] = useState<QueueItem[]>(initialItems);
  const [refreshing, setRefreshing] = useState(false);

  const overdueCount = useMemo(
    () => items.filter((i) => new Date(i.scheduledAt).getTime() < Date.now()).length,
    [items],
  );

  async function refetch() {
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
  }

  function removeItem(postId: string) {
    setItems((prev) => prev.filter((i) => i.postId !== postId));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 py-2 md:py-0">
      <header className="flex items-center justify-between gap-3 px-1 pt-1 md:pt-0">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
            <SiFacebook className="h-5 w-5 text-[#1877F2]" />
            Manual FB queue
          </h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            {items.length === 0
              ? "Nothing waiting — you're caught up."
              : overdueCount > 0
                ? `${overdueCount} overdue · ${items.length} total`
                : `${items.length} scheduled`}
          </p>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={refreshing}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50"
          aria-label="Refresh"
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </button>
      </header>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => (
            <QueueRow
              key={item.slotId ?? `post:${item.postId}`}
              item={item}
              onMarked={() => removeItem(item.postId)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mt-8 rounded-2xl border border-dashed border-gray-200 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
        <Check className="h-6 w-6 text-emerald-700" strokeWidth={2.5} />
      </div>
      <h2 className="text-base font-semibold text-gray-900">Queue's clear</h2>
      <p className="mt-1 text-[13px] text-gray-500">
        No scheduled posts are waiting to be cross-posted to Facebook personal.
      </p>
    </div>
  );
}

function QueueRow({
  item,
  onMarked,
}: {
  item: QueueItem;
  onMarked: () => void;
}) {
  const poster = posterUrl(item);
  const status = relativeStatus(item.scheduledAt);
  const time = formatScheduled(item.scheduledAt);

  const [copied, setCopied] = useState(false);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [marked, setMarked] = useState(false);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (removeTimer.current) clearTimeout(removeTimer.current);
    };
  }, []);

  async function handleCopy() {
    const ok = await copyTextToClipboard(item.body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  }

  async function handleMark() {
    if (marking || marked) return;
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch(`/api/posts/${item.postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "FACEBOOK" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkError(data?.error ?? "Couldn't mark as posted");
        return;
      }
      setMarked(true);
      removeTimer.current = setTimeout(onMarked, 550);
    } catch {
      setMarkError("Network error");
    } finally {
      setMarking(false);
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

  return (
    <li
      className={`overflow-hidden rounded-2xl border shadow-sm transition-all ${toneRing} ${
        marked ? "translate-x-2 opacity-0" : "opacity-100"
      }`}
    >
      <div className="flex gap-3 p-3">
        {/* Thumb */}
        <Link
          href={item.slotId ? `/admin/m/${item.postId}?slot=${item.slotId}` : `/admin/m/${item.postId}`}
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

        {/* Meta + body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tonePill}`}>
              <Clock className="h-3 w-3" />
              {status.label}
            </span>
            <span className="text-[11px] text-gray-500">{time}</span>
            {item.reminderSentAt && (
              <span className="text-[11px] text-gray-400" title="Push reminder fired">
                · reminded
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 break-words text-[13px] leading-snug text-gray-800">
            {item.body || <span className="italic text-gray-400">No caption.</span>}
          </p>
        </div>
      </div>

      {/* Action row */}
      <div className="flex items-stretch border-t border-black/[0.04] bg-white/60">
        <button
          type="button"
          onClick={handleCopy}
          disabled={!item.body}
          className="flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy caption
            </>
          )}
        </button>
        <Link
          href={item.slotId ? `/admin/m/${item.postId}?slot=${item.slotId}` : `/admin/m/${item.postId}`}
          className="flex flex-1 items-center justify-center gap-1.5 border-l border-black/[0.04] py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100"
        >
          Open helper
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
        <button
          type="button"
          onClick={handleMark}
          disabled={marking || marked}
          className={`flex flex-1 items-center justify-center gap-1.5 border-l border-black/[0.04] py-2.5 text-[13px] font-semibold text-white transition-colors disabled:opacity-70 ${
            marked ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-700 active:bg-blue-800"
          }`}
        >
          {marking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          )}
          {marked ? "Done" : "Mark posted"}
        </button>
      </div>
      {markError && (
        <p className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">{markError}</p>
      )}
    </li>
  );
}
