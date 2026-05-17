import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, getSignedDownloadUrl } from "@/lib/storage";
import { DeleteButton, SchedulePanelWithRefresh } from "./PostInteractions";
import { ActivityList } from "./ActivityList";
import { ScheduledBanner } from "./ScheduledBanner";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { CopyIdChip } from "@/app/admin/trash/CopyIdChip";
import { PostEditor } from "./PostEditor";
import { PostNavBar } from "./PostNavBar";
import { PostNavKeys } from "./PostNavKeys";
import { MobilePostActions } from "./MobilePostActions";
import {
  buildNeighborQueries,
  buildPostsQuery,
  parsePostsFilters,
} from "@/lib/posts-query";
import { displayBody } from "@/lib/post-body";

type SearchParams = { [key: string]: string | string[] | undefined };

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
  // Auth (and redirect to /login) is enforced by `src/app/admin/layout.tsx`.
  // We still need the session to scope queries to the signed-in user.
  const session = await auth();
  if (!session?.user?.id) notFound();

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

  // Earliest active planner slot for this post — used by ScheduledBanner to
  // surface "Facebook (manual)" alongside any API-scheduled publishes. We pick
  // the soonest so the banner's headline time matches what the user will see
  // hit first in the queue.
  const activePlannerSlot = await prisma.weeklyPlanSlot.findFirst({
    where: {
      postId: post.id,
      plan: { userId: session.user.id },
      status: { in: ["APPROVED", "SCHEDULED"] },
    },
    orderBy: [{ day: "asc" }, { hour: "asc" }],
    select: { day: true, hour: true },
  });
  const manualSlot = activePlannerSlot
    ? {
        scheduledAt: buildSlotDate(
          activePlannerSlot.day,
          activePlannerSlot.hour ?? FIXED_SLOT_HOURS[0],
        ).toISOString(),
        fbPublished: post.publishes.some(
          (p) => p.platform === "FACEBOOK" && p.status === "PUBLISHED",
        ),
      }
    : null;

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
    fromParam === "planner"
      ? "/admin/planner"
      : fromParam === "assistant"
        ? "/admin/assistant"
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
            url: await getSignedDownloadUrl(m.audioTrack.storageKey).catch(() => null),
          }
        : null,
      url: await getMediaUrl(m).catch(() => null),
    })),
  );

  return (
    <div>
      <MobilePostActions
        postId={id}
        listHref={listHref}
        prevHref={prevHref}
        nextHref={nextHref}
        platformUrl={post.platformUrl}
      />
      <PostNavBar
        prevHref={prevHref}
        nextHref={nextHref}
        listHref={listHref}
        backLabel={
          fromParam === "planner"
            ? "Planner"
            : fromParam === "assistant"
              ? "Assistant"
              : "Posts"
        }
        originalDate={post.originalDate}
        platformUrl={post.platformUrl}
        actions={
          <div className="flex items-center gap-1.5">
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

        <ScheduledBanner
          publishes={post.publishes.map((p) => ({
            platform: p.platform,
            status: p.status,
            scheduledAt: p.scheduledAt ? p.scheduledAt.toISOString() : null,
            publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
          }))}
          manualSlot={manualSlot}
        />

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
          captionSuggestion={
            (post.captionQuality != null || post.captionSuggestion)
              ? {
                  postId: id,
                  currentBody: post.body,
                  suggestion: post.captionSuggestion,
                  quality: post.captionQuality,
                  evergreen: post.captionEvergreen,
                }
              : null
          }
        />

        <SchedulePanelWithRefresh
          postId={id}
          body={post.body}
          media={mediaWithUrls.map((m) => ({ id: m.id, url: m.url, mimeType: m.mimeType }))}
        />

        <ActivityList
          postId={id}
          initialPublishes={post.publishes.map((pr) => ({
            id: pr.id,
            platform: pr.platform,
            status: pr.status,
            platformUrl: pr.platformUrl,
            publishedAt: pr.publishedAt ? pr.publishedAt.toISOString() : null,
            scheduledAt: pr.scheduledAt ? pr.scheduledAt.toISOString() : null,
            errorMessage: pr.errorMessage,
            analytics: pr.analytics
              ? {
                  impressions: pr.analytics.impressions,
                  reach: pr.analytics.reach,
                  likes: pr.analytics.likes,
                  comments: pr.analytics.comments,
                  shares: pr.analytics.shares,
                  saves: pr.analytics.saves,
                  videoViews: pr.analytics.videoViews,
                }
              : null,
          }))}
          initialFbAnalytics={
            post.analytics[0]
              ? {
                  reactions: post.analytics[0].reactions,
                  comments: post.analytics[0].comments,
                  shares: post.analytics[0].shares,
                  fetchedAt: post.analytics[0].fetchedAt.toISOString(),
                }
              : null
          }
          initialFbComments={post.fbComments.map((c) => ({
            id: c.id,
            authorName: c.authorName,
            body: c.body,
          }))}
        />
      </div>
    </div>
  );
}
