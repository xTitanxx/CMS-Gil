import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton, PublishPanelWithRefresh } from "./PostInteractions";
import { CopyIdChip } from "@/app/admin/trash/CopyIdChip";
import { PostEditor } from "./PostEditor";
import { PostNavBar } from "./PostNavBar";
import { PostNavKeys } from "./PostNavKeys";
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
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, sp] = await Promise.all([params, searchParams]);

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: { include: { audioTrack: { select: { id: true, title: true, storageKey: true } } } },
      publishes: { orderBy: { createdAt: "desc" } },
      parentPost: { select: { id: true, body: true, _count: { select: { media: true } } } },
      _count: { select: { childPosts: true } },
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
        ? { id: m.audioTrack.id, title: m.audioTrack.title }
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

      <div className="mx-auto mt-3 w-full max-w-6xl space-y-3">
        {post.parentPost && (
          <a
            href={`/admin/posts/${post.parentPost.id}`}
            className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100"
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
          <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs text-blue-900">
            <span className="font-medium">Album with individual photo posts</span>
            <span className="text-blue-700">
              {post._count.childPosts} linked child {post._count.childPosts === 1 ? "post" : "posts"}
            </span>
          </div>
        )}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <PostEditor
              postId={id}
              initialBody={displayBody(post.body)}
              initialOriginalDate={post.originalDate}
              initialTags={post.tags}
              initialMedia={mediaWithUrls}
              initialPostType={post.postType}
              source={post.source}
              platformUrl={post.platformUrl}
              share={post.share as { url?: string; source?: string; name?: string } | null}
            />
          </div>

          <div className="min-w-0 space-y-3">
            <PublishPanelWithRefresh
              postId={id}
              body={post.body}
              hasVideo={hasVideo}
              media={mediaWithUrls.map((m) => ({ url: m.url, mimeType: m.mimeType }))}
            />

          {/* Publish history */}
          {post.publishes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Publish History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {post.publishes.map((pr) => (
                    <div
                      key={pr.id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                    >
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
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          </div>
        </div>
      </div>
    </div>
  );
}
