"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  Heart,
  Loader2,
  MessageCircle,
  RefreshCw,
  Share2,
  ThumbsUp,
  XCircle,
} from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook, SiThreads, SiSubstack } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { format } from "date-fns";
import {
  PUBLISH_RECORD_CREATED_EVENT,
  type PublishRecordCreatedDetail,
} from "@/lib/publish-events";

type Platform =
  | "INSTAGRAM"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "FACEBOOK_PAGE"
  | "FACEBOOK"
  | "THREADS"
  | "SUBSTACK";

type PublishStatus = "PENDING" | "PROCESSING" | "PUBLISHED" | "FAILED" | "CANCELLED";

type PublishAnalytics = {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  videoViews: number | null;
};

type Publish = {
  id: string;
  platform: Platform;
  status: PublishStatus;
  platformUrl: string | null;
  publishedAt: string | null;
  scheduledAt: string | null;
  errorMessage: string | null;
  analytics: PublishAnalytics | null;
};

type FbAnalytics = {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  fetchedAt: string;
};

type FbComment = {
  id: string;
  authorName: string;
  body: string;
};

const PLATFORM_LABEL: Record<Platform, string> = {
  INSTAGRAM: "Instagram",
  LINKEDIN: "LinkedIn",
  YOUTUBE: "YouTube",
  TIKTOK: "TikTok",
  FACEBOOK_PAGE: "Facebook Page",
  FACEBOOK: "Facebook Personal profile",
  THREADS: "Threads",
  SUBSTACK: "Substack",
};

// True for manually-posted platforms (no API publish path) — drives the
// dashed-outline avatar + Manual badge in the activity row, matching the
// SchedulePanel chip language.
const PLATFORM_MANUAL: Record<Platform, boolean> = {
  INSTAGRAM: false,
  LINKEDIN: false,
  YOUTUBE: false,
  TIKTOK: false,
  FACEBOOK_PAGE: false,
  FACEBOOK: true,
  THREADS: false,
  SUBSTACK: true,
};

// Brand-tinted icon backgrounds. Soft enough not to dominate the row.
const PLATFORM_TINT: Record<Platform, { bg: string; fg: string; border?: string }> = {
  INSTAGRAM: { bg: "bg-pink-50", fg: "text-pink-500" },
  LINKEDIN: { bg: "bg-sky-50", fg: "text-sky-600" },
  YOUTUBE: { bg: "bg-red-50", fg: "text-red-500" },
  TIKTOK: { bg: "bg-gray-100", fg: "text-gray-900" },
  FACEBOOK_PAGE: { bg: "bg-blue-50", fg: "text-blue-600" },
  FACEBOOK: {
    bg: "bg-white",
    fg: "text-blue-600",
    border: "border border-dashed border-blue-400",
  },
  THREADS: { bg: "bg-gray-100", fg: "text-black" },
  SUBSTACK: {
    bg: "bg-white",
    fg: "text-[#FF6719]",
    border: "border border-dashed border-orange-400",
  },
};

function PlatformIcon({
  platform,
  className,
}: {
  platform: Platform;
  className?: string;
}) {
  const cls = className ?? "h-4 w-4";
  switch (platform) {
    case "INSTAGRAM":
      return <SiInstagram className={cls} />;
    case "LINKEDIN":
      return <FaLinkedin className={cls} />;
    case "YOUTUBE":
      return <SiYoutube className={cls} />;
    case "TIKTOK":
      return <SiTiktok className={cls} />;
    case "FACEBOOK_PAGE":
    case "FACEBOOK":
      return <SiFacebook className={cls} />;
    case "THREADS":
      return <SiThreads className={cls} />;
    case "SUBSTACK":
      return <SiSubstack className={cls} />;
  }
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function isActive(status: PublishStatus): boolean {
  return status === "PROCESSING" || status === "PENDING";
}

function statusBadge(status: PublishStatus) {
  switch (status) {
    case "PUBLISHED":
      return { label: "Published", chip: "bg-emerald-50 text-emerald-700 ring-emerald-100" };
    case "FAILED":
      return { label: "Failed", chip: "bg-rose-50 text-rose-700 ring-rose-100" };
    case "PROCESSING":
      return { label: "Processing", chip: "bg-blue-50 text-blue-700 ring-blue-100" };
    case "PENDING":
      return { label: "Pending", chip: "bg-amber-50 text-amber-700 ring-amber-100" };
    case "CANCELLED":
      return { label: "Cancelled", chip: "bg-gray-100 text-gray-500 ring-gray-200" };
  }
}

export function ActivityList({
  postId,
  initialPublishes,
  initialFbAnalytics,
  initialFbComments,
}: {
  postId: string;
  initialPublishes: Publish[];
  initialFbAnalytics: FbAnalytics | null;
  initialFbComments: FbComment[];
}) {
  const [publishes, setPublishes] = useState<Publish[]>(initialPublishes);
  const [fbAnalytics, setFbAnalytics] = useState<FbAnalytics | null>(initialFbAnalytics);
  const [fbComments, setFbComments] = useState<FbComment[]>(initialFbComments);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Set<string>>(() => new Set());
  const [showFailures, setShowFailures] = useState(false);
  const [expandedAnalytics, setExpandedAnalytics] = useState<Set<string>>(() => new Set());

  // Sync state when the server tree re-renders with new data — happens after
  // SchedulePanel calls router.refresh() on a successful action. Without
  // this, useState keeps its initial empty value and the panel stays hidden
  // for any post that had no prior publishes.
  useEffect(() => {
    setPublishes((prev) => (initialPublishes.length > prev.length ? initialPublishes : prev));
  }, [initialPublishes]);
  useEffect(() => {
    setFbAnalytics((prev) => (initialFbAnalytics && !prev ? initialFbAnalytics : prev));
  }, [initialFbAnalytics]);
  useEffect(() => {
    setFbComments((prev) => (initialFbComments.length > prev.length ? initialFbComments : prev));
  }, [initialFbComments]);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/posts/${postId}/publishes`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      publishes: Publish[];
      analytics: Array<{ reactions: number | null; comments: number | null; shares: number | null; fetchedAt: string }>;
      fbComments: FbComment[];
    };
    setPublishes(data.publishes);
    setFbAnalytics(data.analytics[0] ?? null);
    setFbComments(data.fbComments);
  }, [postId]);

  // Poll while any record is still active. Stops polling once everything is
  // settled to avoid background traffic on idle posts.
  const hasActive = publishes.some((p) => isActive(p.status));
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!hasActive) return;
    pollRef.current = setInterval(refresh, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActive, refresh]);

  // SchedulePanel fires this on a successful publish/schedule. The API creates
  // the PublishRecord synchronously before responding, so one refetch lands
  // the new row — which also flips hasActive true and starts the 2.5s poll.
  // Without this, the panel relies on router.refresh() streaming new server
  // data, which is async and unreliable enough that the new record often
  // doesn't appear until a full page reload.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<PublishRecordCreatedDetail>).detail;
      if (detail?.postId !== postId) return;
      void refresh();
    };
    window.addEventListener(PUBLISH_RECORD_CREATED_EVENT, handler);
    return () => window.removeEventListener(PUBLISH_RECORD_CREATED_EVENT, handler);
  }, [postId, refresh]);

  const cancelPublish = useCallback(async (recordId: string) => {
    setCancelling((prev) => {
      const next = new Set(prev);
      next.add(recordId);
      return next;
    });
    try {
      await fetch(`/api/publish/${recordId}/cancel`, { method: "POST" });
      await refresh();
    } finally {
      setCancelling((prev) => {
        const next = new Set(prev);
        next.delete(recordId);
        return next;
      });
    }
  }, [refresh]);

  const refreshAnalytics = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/posts/${postId}/analytics`, { method: "POST" });
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [postId, refresh]);

  const hasPublished = publishes.some((p) => p.status === "PUBLISHED");

  // Bucket publishes for display.
  //  - active: in-flight, keep prominent full rows with cancel
  //  - posted: latest PUBLISHED record per platform, compact one-liner
  //  - failures: FAILED/CANCELLED for platforms with no success — collapsed
  // Records for platforms that eventually succeeded are dropped from failures
  // so a retry success doesn't drag old "Manually reaped" noise back into view.
  const active = publishes.filter(
    (p) => p.status === "PROCESSING" || p.status === "PENDING",
  );

  const publishedByPlatform = new Map<Platform, Publish>();
  for (const p of publishes) {
    if (p.status !== "PUBLISHED") continue;
    const existing = publishedByPlatform.get(p.platform);
    const newTime = p.publishedAt ? new Date(p.publishedAt).getTime() : 0;
    const existingTime = existing?.publishedAt
      ? new Date(existing.publishedAt).getTime()
      : 0;
    if (!existing || newTime > existingTime) {
      publishedByPlatform.set(p.platform, p);
    }
  }
  const succeededPlatforms = new Set(publishedByPlatform.keys());
  const posted = Array.from(publishedByPlatform.values()).sort(
    (a, b) =>
      new Date(b.publishedAt ?? 0).getTime() -
      new Date(a.publishedAt ?? 0).getTime(),
  );

  const failures = publishes.filter(
    (p) =>
      (p.status === "FAILED" || p.status === "CANCELLED") &&
      !succeededPlatforms.has(p.platform),
  );

  const failedCount = failures.filter((p) => p.status === "FAILED").length;
  const cancelledCount = failures.filter((p) => p.status === "CANCELLED").length;

  if (publishes.length === 0 && !fbAnalytics) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-gray-900">Activity</h3>
          {hasActive && (
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-blue-500" />
              </span>
              live
            </span>
          )}
        </div>
        {hasPublished && (
          <button
            onClick={refreshAnalytics}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh analytics"}
          </button>
        )}
      </div>

      {fbAnalytics && (
        <div className="border-t border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50">
              <SiFacebook className="h-4 w-4 text-blue-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-900">Facebook (Personal)</span>
                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-gray-500">
                  Origin
                </span>
              </div>
              <p className="text-[11px] text-gray-400">
                Scraped {format(new Date(fbAnalytics.fetchedAt), "MMM d, yyyy")}
              </p>
            </div>
          </div>
          <div className="ml-12 mt-2 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {fbAnalytics.reactions != null && (
              <span className="flex items-center gap-1.5 text-[12px] text-gray-600">
                <Heart className="h-3.5 w-3.5 text-rose-400" />
                <span className="font-semibold">{formatNum(fbAnalytics.reactions)}</span>
                <span className="text-gray-400">reactions</span>
              </span>
            )}
            {fbAnalytics.comments != null && (
              <span className="flex items-center gap-1.5 text-[12px] text-gray-600">
                <MessageCircle className="h-3.5 w-3.5 text-blue-400" />
                <span className="font-semibold">{formatNum(fbAnalytics.comments)}</span>
                <span className="text-gray-400">comments</span>
              </span>
            )}
            {fbAnalytics.shares != null && (
              <span className="flex items-center gap-1.5 text-[12px] text-gray-600">
                <Share2 className="h-3.5 w-3.5 text-emerald-400" />
                <span className="font-semibold">{formatNum(fbAnalytics.shares)}</span>
                <span className="text-gray-400">shares</span>
              </span>
            )}
          </div>
          {fbComments.length > 0 && (
            <div className="ml-12 mt-3">
              <p className="mb-1.5 text-[11px] font-medium text-gray-400">
                Comments ({fbComments.length})
              </p>
              <div className="max-h-48 space-y-1.5 overflow-y-auto">
                {fbComments.slice(0, 10).map((c) => (
                  <div key={c.id} className="text-xs">
                    <span className="font-medium text-gray-700">{c.authorName}</span>
                    <span className="ml-1.5 text-gray-500">{c.body}</span>
                  </div>
                ))}
                {fbComments.length > 10 && (
                  <p className="text-[10px] text-gray-400">+{fbComments.length - 10} more</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {active.length > 0 && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {active.map((pr) => (
            <ActiveRow
              key={pr.id}
              pr={pr}
              cancelling={cancelling.has(pr.id)}
              onCancel={() => cancelPublish(pr.id)}
            />
          ))}
        </div>
      )}

      {posted.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3">
          <ul className="flex flex-col">
            {posted.map((pr) => (
              <PostedRow
                key={pr.id}
                pr={pr}
                analyticsOpen={expandedAnalytics.has(pr.id)}
                onToggleAnalytics={() =>
                  setExpandedAnalytics((prev) => {
                    const next = new Set(prev);
                    if (next.has(pr.id)) next.delete(pr.id);
                    else next.add(pr.id);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </div>
      )}

      {failures.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowFailures((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-2.5 text-left text-[11px] text-gray-500 transition hover:bg-gray-50"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3 text-gray-400" />
              {[
                failedCount > 0
                  ? `${failedCount} failed ${failedCount === 1 ? "attempt" : "attempts"}`
                  : null,
                cancelledCount > 0
                  ? `${cancelledCount} cancelled`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
                showFailures ? "rotate-180" : ""
              }`}
            />
          </button>
          {showFailures && (
            <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/40">
              {failures.map((pr) => (
                <FailureRow
                  key={pr.id}
                  pr={pr}
                  errorOpen={expandedError === pr.id}
                  onToggleError={() =>
                    setExpandedError(expandedError === pr.id ? null : pr.id)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function StatusOverlay({ status }: { status: PublishStatus }) {
  return (
    <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white">
      {status === "PUBLISHED" && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
      {status === "FAILED" && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
      {status === "PROCESSING" && <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />}
      {status === "PENDING" && <Clock className="h-3.5 w-3.5 text-amber-500" />}
      {status === "CANCELLED" && <XCircle className="h-3.5 w-3.5 text-gray-400" />}
    </div>
  );
}

function ActiveRow({
  pr,
  cancelling,
  onCancel,
}: {
  pr: Publish;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const tint = PLATFORM_TINT[pr.platform];
  const badge = statusBadge(pr.status);
  const subtitle =
    pr.scheduledAt && pr.status === "PENDING"
      ? `Scheduled for ${format(new Date(pr.scheduledAt), "MMM d · h:mm a")}`
      : pr.status === "PROCESSING"
        ? "Sending to platform..."
        : "Pending";

  return (
    <div
      className={`px-5 py-3.5 ${pr.status === "PROCESSING" ? "bg-blue-50/30" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="relative">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tint.bg} ${tint.border ?? ""}`}
          >
            <PlatformIcon platform={pr.platform} className={`h-4 w-4 ${tint.fg}`} />
          </div>
          <StatusOverlay status={pr.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-gray-900">
              {PLATFORM_LABEL[pr.platform]}
            </span>
            {PLATFORM_MANUAL[pr.platform] && (
              <span className="rounded-sm bg-blue-50 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200">
                Manual
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500">{subtitle}</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset ${badge.chip}`}
        >
          {badge.label}
        </span>
      </div>
      <div className="ml-12 mt-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <XCircle className="h-3 w-3" />
          {cancelling
            ? "Cancelling…"
            : pr.scheduledAt
              ? "Cancel scheduling"
              : "Cancel"}
        </button>
      </div>
    </div>
  );
}

function PostedRow({
  pr,
  analyticsOpen,
  onToggleAnalytics,
}: {
  pr: Publish;
  analyticsOpen: boolean;
  onToggleAnalytics: () => void;
}) {
  const tint = PLATFORM_TINT[pr.platform];
  const a = pr.analytics;
  const hasAnalytics =
    !!a &&
    (a.videoViews != null ||
      a.impressions != null ||
      a.reach != null ||
      a.likes != null ||
      a.comments != null ||
      a.shares != null ||
      a.saves != null);
  const recent =
    // eslint-disable-next-line react-hooks/purity -- coarse "<24h ago" check; minor render-time variance is fine for an italic hint
    pr.publishedAt && Date.now() - new Date(pr.publishedAt).getTime() < 86_400_000;

  return (
    <li className="py-1.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="relative">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tint.bg} ${tint.border ?? ""}`}
          >
            <PlatformIcon platform={pr.platform} className={`h-3.5 w-3.5 ${tint.fg}`} />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white">
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-[13px] font-medium text-gray-900">
            {PLATFORM_LABEL[pr.platform]}
          </span>
          {PLATFORM_MANUAL[pr.platform] && (
            <span className="rounded-sm bg-blue-50 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-blue-700 ring-1 ring-inset ring-blue-200">
              Manual
            </span>
          )}
          {pr.publishedAt && (
            <span className="text-[11px] text-gray-500">
              {format(new Date(pr.publishedAt), "MMM d · h:mm a")}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasAnalytics && (
            <button
              type="button"
              onClick={onToggleAnalytics}
              aria-expanded={analyticsOpen}
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            >
              Stats
              <ChevronDown
                className={`h-3 w-3 transition-transform ${analyticsOpen ? "rotate-180" : ""}`}
              />
            </button>
          )}
          {pr.platformUrl && (
            <a
              href={pr.platformUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-100 transition-colors hover:bg-blue-100"
              aria-label="Open published post"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </a>
          )}
        </div>
      </div>
      {hasAnalytics && analyticsOpen && a && (
        <div className="ml-[2.375rem] mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
          {a.videoViews != null && <Stat icon={Eye} value={a.videoViews} label="views" />}
          {a.impressions != null && <Stat icon={Eye} value={a.impressions} label="impressions" />}
          {a.reach != null && <Stat icon={Eye} value={a.reach} label="reach" />}
          {a.likes != null && <Stat icon={ThumbsUp} value={a.likes} />}
          {a.comments != null && <Stat icon={MessageCircle} value={a.comments} />}
          {a.shares != null && <Stat icon={Share2} value={a.shares} />}
          {a.saves != null && <Stat icon={Bookmark} value={a.saves} />}
        </div>
      )}
      {!hasAnalytics && recent && (
        <p className="ml-[2.375rem] mt-0.5 text-[10px] italic text-gray-400">
          Analytics available ~24h after posting
        </p>
      )}
    </li>
  );
}

function FailureRow({
  pr,
  errorOpen,
  onToggleError,
}: {
  pr: Publish;
  errorOpen: boolean;
  onToggleError: () => void;
}) {
  const tint = PLATFORM_TINT[pr.platform];
  const badge = statusBadge(pr.status);
  const subtitle =
    pr.status === "FAILED"
      ? "Publish failed"
      : pr.status === "CANCELLED"
        ? "Cancelled"
        : "";

  return (
    <li className="px-5 py-3">
      <div className="flex items-center gap-3">
        <div className="relative">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tint.bg} ${tint.border ?? ""} opacity-70`}
          >
            <PlatformIcon platform={pr.platform} className={`h-3.5 w-3.5 ${tint.fg}`} />
          </div>
          <StatusOverlay status={pr.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[12px] font-medium text-gray-700">
              {PLATFORM_LABEL[pr.platform]}
            </span>
            <span className="text-[11px] text-gray-500">{subtitle}</span>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${badge.chip}`}
        >
          {badge.label}
        </span>
      </div>
      {pr.errorMessage && (
        <div className="ml-10 mt-1.5">
          <button
            type="button"
            onClick={onToggleError}
            className="group inline-flex max-w-full items-start gap-1.5 rounded-md text-[11px] text-rose-600 hover:text-rose-700"
          >
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className={errorOpen ? "" : "truncate"}>
              {errorOpen ? pr.errorMessage : friendlyError(pr.errorMessage)}
            </span>
            <ChevronDown
              className={`mt-0.5 h-3 w-3 shrink-0 text-rose-400 transition-transform ${
                errorOpen ? "rotate-180" : ""
              }`}
            />
          </button>
        </div>
      )}
    </li>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number;
  label?: string;
}) {
  return (
    <span className="flex items-center gap-1 text-[11px] text-gray-500">
      <Icon className="h-3 w-3 text-gray-400" />
      <span className="font-medium text-gray-700">{formatNum(value)}</span>
      {label && <span className="text-gray-400">{label}</span>}
    </span>
  );
}

// Error messages from upstream platforms are JSON blobs that read like a
// crash dump. Strip the wrapper so the user sees the human sentence first;
// the full string is still one click away.
function friendlyError(raw: string): string {
  if (!raw) return "Publish failed";
  const m = raw.match(/"message"\s*:\s*"([^"]+)"/);
  if (m) return m[1];
  return raw.replace(/^Error:\s*/, "").trim();
}
