import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink, BarChart2 } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton, PublishPanelWithRefresh } from "./PostInteractions";
import { PostEditor } from "./PostEditor";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: true,
      publishes: { orderBy: { createdAt: "desc" } },
      analytics: { where: { platform: "FACEBOOK" } },
    },
  });

  if (!post) notFound();

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(() => null),
    }))
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/posts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <Badge variant="outline">{post.source}</Badge>
        </div>
        <DeleteButton postId={id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable post content */}
        <div className="lg:col-span-2 space-y-4">
          <PostEditor
            postId={id}
            initialBody={post.body}
            initialOriginalDate={post.originalDate}
            initialTags={post.tags}
            initialMedia={mediaWithUrls}
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

        {/* Publish Panel */}
        <div>
          <PublishPanelWithRefresh postId={id} />
        </div>
      </div>
    </div>
  );
}
