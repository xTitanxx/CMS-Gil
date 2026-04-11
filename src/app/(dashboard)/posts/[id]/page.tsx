import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BarChart2, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton, PublishPanelWithRefresh } from "./PostInteractions";
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

function MetricTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3 text-center">
      <p className="text-xl font-semibold text-gray-900">{value ?? "—"}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
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
      media: true,
      publishes: { orderBy: { createdAt: "desc" } },
      analytics: { where: { platform: "FACEBOOK" } },
    },
  });

  if (!post) notFound();

  const filters = parsePostsFilters(sp);
  const { where: baseWhere } = buildPostsQuery(filters, session.user.id);
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

  const prevHref = prev
    ? `/posts/${prev.id}${neighborQuery ? `?${neighborQuery}` : ""}`
    : null;
  const nextHref = next
    ? `/posts/${next.id}${neighborQuery ? `?${neighborQuery}` : ""}`
    : null;
  const listHref = `/posts${listQuery ? `?${listQuery}` : ""}`;

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      hasAudio: m.hasAudio,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
        () => null,
      ),
    })),
  );

  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));

  return (
    <div>
      <PostNavBar
        prevHref={prevHref}
        nextHref={nextHref}
        listHref={listHref}
        source={post.source}
        platformUrl={post.platformUrl}
      />
      <PostNavKeys
        prevHref={prevHref}
        nextHref={nextHref}
        listHref={listHref}
      />

      <div className="mx-auto mt-3 w-full max-w-6xl space-y-3">
        <div className="flex items-center justify-end">
          <DeleteButton postId={id} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <PostEditor
              postId={id}
              initialBody={displayBody(post.body)}
              initialOriginalDate={post.originalDate}
              initialTags={post.tags}
              initialMedia={mediaWithUrls}
            />
          </div>

          <div className="space-y-3">
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

          {/* Facebook Analytics */}
          {post.source === "FACEBOOK" && (() => {
            const fbAnalytics = post.analytics[0] ?? null;
            return (
              <Card>
                <CardHeader className="flex flex-row items-center gap-2 pb-3">
                  <BarChart2 className="h-4 w-4 text-blue-600" />
                  <CardTitle className="text-base">Facebook Analytics</CardTitle>
                </CardHeader>
                <CardContent>
                  {!fbAnalytics ? (
                    <p className="text-sm text-gray-400">Analytics pending — syncs nightly at 3am</p>
                  ) : !fbAnalytics.platformPostId ? (
                    <p className="text-sm text-gray-400">Post not yet matched — syncs nightly at 3am</p>
                  ) : (
                    <div>
                      <div className="grid grid-cols-3 gap-3">
                        <MetricTile label="Reactions" value={fbAnalytics.reactions} />
                        <MetricTile label="Comments" value={fbAnalytics.comments} />
                        <MetricTile label="Shares" value={fbAnalytics.shares} />
                        {fbAnalytics.reach !== null && (
                          <MetricTile label="Reach" value={fbAnalytics.reach} />
                        )}
                        {fbAnalytics.impressions !== null && (
                          <MetricTile label="Impressions" value={fbAnalytics.impressions} />
                        )}
                      </div>
                      <p className="mt-3 text-xs text-gray-400">
                        Last updated:{" "}
                        {format(new Date(fbAnalytics.fetchedAt), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
