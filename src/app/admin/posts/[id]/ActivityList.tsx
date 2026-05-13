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
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { format } from "date-fns";

type Platform =
  | "INSTAGRAM"
  | "LINKEDIN"
  | "YOUTUBE"
  | "TIKTOK"
  | "FACEBOOK_PAGE"
  | "FACEBOOK";

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
  FACEBOOK: "Facebook",
};

// Brand-tinted icon backgrounds. Soft enough not to dominate the row.
const PLATFORM_TINT: Record<Platform, { bg: string; fg: string }> = {
  INSTAGRAM: { bg: "bg-pink-50", fg: "text-pink-500" },
  LINKEDIN: { bg: "bg-sky-50", fg: "text-sky-600" },
  YOUTUBE: { bg: "bg-red-50", fg: "text-red-500" },
  TIKTOK: { bg: "bg-gray-100", fg: "text-gray-900" },
  FACEBOOK_PAGE: { bg: "bg-blue-50", fg: "text-blue-600" },
  FACEBOOK: { bg: "bg-blue-50", fg: "text-blue-600" },
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

  // Sync state when the server tree re-renders with new data — happens after
  // PublishPanel calls router.refresh() on a successful Post Now. Without
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

      {publishes.length > 0 && (
        <div className="divide-y divide-gray-100 border-t border-gray-100">
          {publishes.map((pr) => {
            const tint = PLATFORM_TINT[pr.platform];
            const badge = statusBadge(pr.status);
            const a = pr.analytics;
            const showError = !!pr.errorMessage;
            const errorOpen = expandedError === pr.id;

            const subtitle = pr.publishedAt
              ? format(new Date(pr.publishedAt), "MMM d, yyyy · h:mm a")
              : pr.scheduledAt && pr.status === "PENDING"
              ? `Scheduled for ${format(new Date(pr.scheduledAt), "MMM d · h:mm a")}`
              : pr.status === "PROCESSING"
              ? "Sending to platform..."
              : pr.status === "FAILED"
              ? "Publish failed"
              : pr.status === "CANCELLED"
              ? "Cancelled"
              : "Pending";

            return (
              <div
                key={pr.id}
                className={`px-5 py-3.5 transition-colors ${
                  pr.status === "PROCESSING" ? "bg-blue-50/30" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${tint.bg}`}
                    >
                      <PlatformIcon platform={pr.platform} className={`h-4 w-4 ${tint.fg}`} />
                    </div>
                    <div className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white">
                      {pr.status === "PUBLISHED" && (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                      {pr.status === "FAILED" && (
                        <XCircle className="h-3.5 w-3.5 text-rose-500" />
                      )}
                      {pr.status === "PROCESSING" && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                      )}
                      {pr.status === "PENDING" && (
                        <Clock className="h-3.5 w-3.5 text-amber-500" />
                      )}
                      {pr.status === "CANCELLED" && (
                        <XCircle className="h-3.5 w-3.5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-gray-900">
                        {PLATFORM_LABEL[pr.platform]}
                      </span>
                      {pr.platformUrl && (
                        <a
                          href={pr.platformUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-400 transition-colors hover:text-blue-600"
                          aria-label="Open published post"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
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

                {showError && (
                  <div className="ml-12 mt-2">
                    <button
                      type="button"
                      onClick={() => setExpandedError(errorOpen ? null : pr.id)}
                      className="group inline-flex max-w-full items-start gap-1.5 rounded-md text-[11px] text-rose-600 hover:text-rose-700"
                    >
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className={errorOpen ? "" : "truncate"}>
                        {errorOpen
                          ? pr.errorMessage
                          : friendlyError(pr.errorMessage ?? "")}
                      </span>
                      <ChevronDown
                        className={`mt-0.5 h-3 w-3 shrink-0 text-rose-400 transition-transform ${
                          errorOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </div>
                )}

                {a && (
                  <div className="ml-12 mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                    {a.videoViews != null && (
                      <Stat icon={Eye} value={a.videoViews} label="views" />
                    )}
                    {a.impressions != null && (
                      <Stat icon={Eye} value={a.impressions} label="impressions" />
                    )}
                    {a.reach != null && <Stat icon={Eye} value={a.reach} label="reach" />}
                    {a.likes != null && <Stat icon={ThumbsUp} value={a.likes} />}
                    {a.comments != null && <Stat icon={MessageCircle} value={a.comments} />}
                    {a.shares != null && <Stat icon={Share2} value={a.shares} />}
                    {a.saves != null && <Stat icon={Bookmark} value={a.saves} />}
                  </div>
                )}

                {pr.status === "PENDING" && (
                  <div className="ml-12 mt-2">
                    <button
                      type="button"
                      onClick={() => cancelPublish(pr.id)}
                      disabled={cancelling.has(pr.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] font-medium text-gray-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <XCircle className="h-3 w-3" />
                      {cancelling.has(pr.id) ? "Cancelling…" : "Cancel scheduling"}
                    </button>
                  </div>
                )}

                {pr.status === "PUBLISHED" && !a && pr.publishedAt && (
                  <p className="ml-12 mt-1.5 text-[11px] italic text-gray-400">
                    {Date.now() - new Date(pr.publishedAt).getTime() < 86400000
                      ? "Analytics available ~24h after posting"
                      : "No analytics yet"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
