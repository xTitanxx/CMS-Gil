import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Heart, MessageCircle, Share2 } from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, getSignedDownloadUrl } from "@/lib/storage";
// Card components removed — publish history uses inline styles now
import { DeleteButton, PublishPanelWithRefresh } from "./PostInteractions";
import { AnalyticsRefreshButton } from "./AnalyticsRefreshButton";
import { CopyIdChip } from "@/app/admin/trash/CopyIdChip";
import { PostEditor } from "./PostEditor";
import { PostNavBar } from "./PostNavBar";
import { PostNavKeys } from "./PostNavKeys";
import { CaptionSuggestionPanel } from "./CaptionSuggestionPanel";
import {
  buildNeighborQueries,
  buildPostsQuery,
  parsePostsFilters,
} from "@/lib/posts-query";
import { displayBody } from "@/lib/post-body";

type SearchParams = { [key: string]: string | string[] | undefined };

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

function serializeListQuery(sp: SearchParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value == null) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) qs.set(key, v);
  }
  return qs.toString();
}

function serializeNeighborQuery(sp: SearchParams): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (value == null) continue;
    const v = Array.isArray(value) ? value[0] : value;
    if (v) qs.set(key, v);
  }
  return qs.toString();
}

export default async function PostDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: { include: { audioTrack: { select: { id: true, title: true, storageKey: true } } } },
      publishes: { orderBy: { createdAt: "desc" }, include: { analytics: true } },
      analytics: { where: { platform: "FACEBOOK" }, take: 1 },
      fbComments: { orderBy: { scrapedAt: "desc" } },
      parentPost: { select: { id: true, body: true, _count: { select: { media: true } } } },
      _count: { select: { childPosts: true } },
      rating: true,
    },
  });

  if (!post) notFound();

  const filters = parsePostsFilters(sp);
  const postIdAllowlist =
    filters.multiMedia === "2"
      ? (
          await prisma.$queryRaw<Array<{ postId: string }>>`
            SELECT m."postId"
            FROM "Media" m
            JOIN "Post" p ON p.id = m."postId"
            WHERE p."userId" = ${session.user.id}
            GROUP BY m."postId"
            HAVING COUNT(*) >= 2
          `
        ).map((r) => r.postId)
      : filters.multiMedia === "1"
        ? (
            await prisma.$queryRaw<Array<{ postId: string }>>`
              SELECT m."postId"
              FROM "Media" m
              JOIN "Post" p ON p.id = m."postId"
              WHERE p."userId" = ${session.user.id}
              GROUP BY m."postId"
              HAVING COUNT(*) = 1
            `
          ).map((r) => r.postId)
        : null;
  const { where: baseWhere } = buildPostsQuery(filters, session.user.id, {
    postIdAllowlist,
  });
  const neighbors = buildNeighborQueries(filters.sort, {
    id: post.id,
    originalDate: post.originalDate,
    createdAt: post.createdAt,
  });

  const [prev, next] = await Promise.all([
    prisma.post.findFirst({
      where: { AND: [baseWhere, neighbors.prevWhere] },
      orderBy: neighbors.prevOrderBy,
      select: { id: true },
    }),
    prisma.post.findFirst({
      where: { AND: [baseWhere, neighbors.nextWhere] },
      orderBy: neighbors.nextOrderBy,
      select: { id: true },
    }),
  ]);

  const neighborQuery = serializeNeighborQuery(sp);
  const listQuery = serializeListQuery(sp);
  const fromParam = Array.isArray(sp.from) ? sp.from[0] : sp.from;

  const prevHref = prev
    ? `/admin/posts/${prev.id}${neighborQuery ? `?${neighborQuery}` : ""}`
    : null;
  const nextHref = next
    ? `/admin/posts/${next.id}${neighborQuery ? `?${neighborQuery}` : ""}`
    : null;
  const listHref =
    fromParam === "dashboard"
      ? "/admin/dashboard"
      : `/admin/posts${listQuery ? `?${listQuery}` : ""}`;

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      hasAudio: m.hasAudio,
      audioTrack: m.audioTrack
        ? {
            id: m.audioTrack.id,
            title: m.audioTrack.title,
            url: await getSignedDownloadUrl(m.audioTrack.storageKey, 3600, "audio/mpeg").catch(() => null),
          }
        : null,
      url: await getMediaUrl(m).catch(() => null),
    })),
  );

  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));

  return (
    <div>
      <PostNavBar
        prevHref={prevHref}
        nextHref={nextHref}
        listHref={listHref}
        actions={
          <div className="flex items-center gap-2">
            <CopyIdChip id={id} />
            <DeleteButton postId={id} />
          </div>
        }
      />
      <PostNavKeys
        prevHref={prevHref}
        nextHref={nextHref}
        listHref={listHref}
      />

      <div className="mx-auto mt-3 w-full max-w-2xl space-y-3">
        {post.parentPost && (
          <a
            href={`/admin/posts/${post.parentPost.id}`}
            className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 hover:bg-amber-100"
          >
            <span className="font-medium">Part of album</span>
            <span className="text-amber-700">
              {post.parentPost._count.media} photos
              {post.parentPost.body
                ? ` — ${post.parentPost.body.slice(0, 60).replace(/\s+/g, " ")}${post.parentPost.body.length > 60 ? "…" : ""}`
                : ""}
            </span>
          </a>
        )}
        {post._count.childPosts > 0 && (
          <div className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <span className="font-medium">Album</span>
            <span className="text-blue-700">
              {post._count.childPosts} linked {post._count.childPosts === 1 ? "post" : "posts"}
            </span>
          </div>
        )}

        <PostEditor
          postId={id}
          initialBody={displayBody(post.body)}
          initialOriginalDate={post.originalDate}
          initialTags={post.tags}
          initialMedia={mediaWithUrls}
          initialPostType={post.postType}
          initialLifecycle={post.lifecycle}
          initialSeason={post.season ?? null}
          source={post.source}
          platformUrl={post.platformUrl}
          share={post.share as { url?: string; source?: string; name?: string } | null}
          rating={post.rating ? { stars: post.rating.stars, reasons: post.rating.reasons, note: post.rating.note } : null}
        />

        {(post.captionQuality != null || post.captionSuggestion) && (
          <CaptionSuggestionPanel
            postId={id}
            currentBody={post.body}
            suggestion={post.captionSuggestion}
            quality={post.captionQuality}
            evergreen={post.captionEvergreen}
          />
        )}

        <PublishPanelWithRefresh
          postId={id}
          body={post.body}
          hasVideo={hasVideo}
          media={mediaWithUrls.map((m) => ({ url: m.url, mimeType: m.mimeType }))}
        />

        {/* Publish history with analytics */}
        {post.publishes.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="text-sm font-semibold text-gray-900">Publish History</h3>
              {post.publishes.some((pr) => pr.status === "PUBLISHED") && (
                <AnalyticsRefreshButton postId={id} />
              )}
            </div>
            <div className="space-y-2 px-4 pb-4">
              {post.publishes.map((pr) => {
                const a = pr.analytics;
                const metrics = a
                  ? [
                      a.videoViews != null && `${formatNum(a.videoViews)} views`,
                      a.impressions != null && `${formatNum(a.impressions)} impressions`,
                      a.reach != null && `${formatNum(a.reach)} reach`,
                      a.likes != null && `${formatNum(a.likes)} likes`,
                      a.comments != null && `${formatNum(a.comments)} comments`,
                      a.shares != null && `${formatNum(a.shares)} shares`,
                      a.saves != null && `${formatNum(a.saves)} saves`,
                    ].filter(Boolean)
                  : [];

                return (
                  <div
                    key={pr.id}
                    className="rounded-lg bg-gray-50 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-medium">{pr.platform}</span>
                        {pr.scheduledAt && pr.status === "PENDING" && (
                          <span className="ml-2 text-xs text-gray-500">
                            Scheduled: {format(new Date(pr.scheduledAt), "MMM d, h:mm a")}
                          </span>
                        )}
                        {pr.publishedAt && (
                          <span className="ml-2 text-xs text-gray-500">
                            {format(new Date(pr.publishedAt), "MMM d, h:mm a")}
                          </span>
                        )}
                        {pr.errorMessage && (
                          <p className="mt-1 text-xs text-red-600">{pr.errorMessage}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            pr.status === "PUBLISHED"
                              ? "success"
                              : pr.status === "FAILED"
                              ? "destructive"
                              : pr.status === "PENDING"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {pr.status}
                        </Badge>
                        {pr.platformUrl && (
                          <a
                            href={pr.platformUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                    {metrics.length > 0 && (
                      <p className="mt-1.5 text-xs text-gray-500">
                        {metrics.join(" · ")}
                      </p>
                    )}
                    {pr.status === "PUBLISHED" && !a && pr.publishedAt && (
                      <p className="mt-1.5 text-xs text-gray-400 italic">
                        {Date.now() - new Date(pr.publishedAt).getTime() < 86400000
                          ? "Analytics available ~24h after posting"
                          : "No analytics yet"}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* Facebook Analytics (scraped) */}
        {post.analytics.length > 0 && (() => {
          const fb = post.analytics[0];
          return (
            <div className="rounded-2xl border border-blue-100 bg-white shadow-sm">
              <div className="flex items-center justify-between px-4 py-3">
                <h3 className="text-sm font-semibold text-gray-900">Facebook Analytics</h3>
                <span className="text-[10px] text-gray-400">
                  Scraped {format(new Date(fb.fetchedAt), "MMM d, yyyy")}
                </span>
              </div>
              <div className="flex items-center gap-6 px-4 pb-3">
                {fb.reactions != null && (
                  <div className="flex items-center gap-1.5">
                    <Heart className="h-4 w-4 text-rose-400" />
                    <span className="text-lg font-semibold text-gray-900">{formatNum(fb.reactions)}</span>
                    <span className="text-xs text-gray-500">reactions</span>
                  </div>
                )}
                {fb.comments != null && (
                  <div className="flex items-center gap-1.5">
                    <MessageCircle className="h-4 w-4 text-blue-400" />
                    <span className="text-lg font-semibold text-gray-900">{formatNum(fb.comments)}</span>
                    <span className="text-xs text-gray-500">comments</span>
                  </div>
                )}
                {fb.shares != null && (
                  <div className="flex items-center gap-1.5">
                    <Share2 className="h-4 w-4 text-green-400" />
                    <span className="text-lg font-semibold text-gray-900">{formatNum(fb.shares)}</span>
                    <span className="text-xs text-gray-500">shares</span>
                  </div>
                )}
              </div>
              {post.fbComments.length > 0 && (
                <div className="border-t border-gray-100 px-4 py-3">
                  <p className="mb-2 text-xs font-medium text-gray-500">
                    Top comments ({post.fbComments.length})
                  </p>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {post.fbComments.slice(0, 10).map((c) => (
                      <div key={c.id} className="text-xs">
                        <span className="font-medium text-gray-700">{c.authorName}</span>
                        <span className="ml-1.5 text-gray-500">{c.body}</span>
                      </div>
                    ))}
                    {post.fbComments.length > 10 && (
                      <p className="text-[10px] text-gray-400">
                        +{post.fbComments.length - 10} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
