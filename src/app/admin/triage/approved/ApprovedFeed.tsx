"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RotateCcw, Loader2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/app/admin/_shared/PageHeader";

interface ApprovedMedia {
  id: string;
  mimeType: string;
  thumbnailUrl: string | null;
  url: string | null;
}

interface ApprovedPost {
  id: string;
  body: string;
  originalDate: string;
  triageApprovedAt: string | null;
  thumbUrl: string | null;
  media: ApprovedMedia[];
}

interface Page {
  posts: ApprovedPost[];
  total: number;
  filteredTotal: number;
  nextCursor: string | null;
}

const RELATIVE_THRESHOLDS: Array<[number, Intl.RelativeTimeFormatUnit]> = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.34524, "week"],
  [12, "month"],
  [Infinity, "year"],
];

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = (then - Date.now()) / 1000;
  let value = seconds;
  let unit: Intl.RelativeTimeFormatUnit = "second";
  for (const [step, candidate] of RELATIVE_THRESHOLDS) {
    if (Math.abs(value) < step) {
      unit = candidate;
      break;
    }
    value /= step;
    unit = candidate;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round(value),
    unit,
  );
}

export function ApprovedFeed() {
  const [posts, setPosts] = useState<ApprovedPost[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [unapproved, setUnapproved] = useState<Set<string>>(new Set());
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchPage = useCallback(async (cursor?: string | null) => {
    const params = new URLSearchParams({ view: "approved" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`/api/triage?${params}`);
    if (!res.ok) throw new Error("fetch failed");
    return (await res.json()) as Page;
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchPage()
      .then((p) => {
        setPosts(p.posts);
        setNextCursor(p.nextCursor);
        setTotal(p.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !nextCursor || loadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && nextCursor && !loadingMore) {
          setLoadingMore(true);
          fetchPage(nextCursor)
            .then((p) => {
              setPosts((prev) => [...prev, ...p.posts]);
              setNextCursor(p.nextCursor);
            })
            .catch(() => {})
            .finally(() => setLoadingMore(false));
        }
      },
      { rootMargin: "300px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore, fetchPage]);

  async function unapprove(postId: string) {
    setBusy(postId);
    const res = await fetch(`/api/triage/${postId}/unapprove`, { method: "POST" });
    setBusy(null);
    if (res.ok) {
      setUnapproved((prev) => {
        const next = new Set(prev);
        next.add(postId);
        return next;
      });
      setTotal((t) => Math.max(0, t - 1));
    }
  }

  const subtitle = loading
    ? "Posts you manually approved in Triage."
    : `${total} post${total === 1 ? "" : "s"} approved`;

  const Header = <PageHeader title="Approved" subtitle={subtitle} />;

  if (loading) {
    return (
      <div>
        {Header}
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      </div>
    );
  }

  const visible = posts.filter((p) => !unapproved.has(p.id));

  if (visible.length === 0) {
    return (
      <div>
        {Header}
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="mb-3 h-10 w-10 text-gray-300" />
          <p className="text-lg font-semibold text-gray-800">No approvals yet.</p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            Posts you mark ready in the Needs fixes tab will appear here, so you can see what
            you&apos;ve worked through.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {Header}
      <ul className="space-y-3">
        {visible.map((post) => {
          const isBusy = busy === post.id;
          return (
            <li
              key={post.id}
              className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm"
            >
              {post.thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={post.thumbUrl}
                  alt=""
                  className="h-16 w-16 flex-shrink-0 rounded-lg bg-gray-100 object-cover"
                />
              ) : (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-300">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm text-gray-800">
                  {post.body || <span className="italic text-gray-400">No caption</span>}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500">
                  <span className="inline-flex items-center gap-1 text-green-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Approved{" "}
                    {post.triageApprovedAt ? (
                      <span title={new Date(post.triageApprovedAt).toLocaleString()}>
                        {relativeTime(post.triageApprovedAt)}
                      </span>
                    ) : null}
                  </span>
                  <span>·</span>
                  <span>
                    Original:{" "}
                    {new Date(post.originalDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Link
                    href={`/admin/posts/${post.id}`}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open post
                  </Link>
                  <button
                    type="button"
                    onClick={() => unapprove(post.id)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3 w-3" />
                    )}
                    Undo approval
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="py-4 text-center text-sm text-gray-400">Loading more…</div>
      )}
    </div>
  );
}
