import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { format } from "date-fns";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const [totalPosts, totalPublished, pendingScheduled, recentPosts, recentJobs] =
    await Promise.all([
      prisma.post.count({ where: { userId } }),
      prisma.publishRecord.count({ where: { post: { userId }, status: "PUBLISHED" } }),
      prisma.publishRecord.count({
        where: { post: { userId }, status: "PENDING", scheduledAt: { not: null } },
      }),
      prisma.post.findMany({
        where: { userId },
        orderBy: { originalDate: "desc" },
        take: 6,
        include: { media: { take: 1 }, publishes: { select: { platform: true, status: true } } },
      }),
      prisma.importJob.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 3,
      }),
    ]);

  const stats = [
    { label: "Total Posts", value: totalPosts },
    { label: "Published", value: totalPublished },
    { label: "Scheduled", value: pendingScheduled },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Welcome back, {session?.user?.name}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <p className="text-3xl font-bold text-gray-900">{s.value}</p>
              <p className="mt-1 text-sm text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recent Import Jobs */}
      {recentJobs.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">
            Recent Imports
          </h2>
          <div className="space-y-2">
            {recentJobs.map((job) => (
              <div
                key={job.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{job.filename}</p>
                  <p className="text-xs text-gray-500">
                    {job.importedPosts} imported · {job.skippedPosts} skipped
                  </p>
                </div>
                <StatusBadge status={job.status} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Posts */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
            Recent Posts
          </h2>
          <Link href="/posts" className="text-sm text-blue-600 hover:underline">
            View all
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {recentPosts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`}>
              <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
                <CardContent className="pt-4">
                  <p className="mb-2 text-xs text-gray-400">
                    {format(new Date(post.originalDate), "MMM d, yyyy")}
                  </p>
                  <p className="line-clamp-3 text-sm text-gray-700">{post.body}</p>
                  {post.media.length > 0 && (
                    <p className="mt-2 text-xs text-gray-400">
                      {post.media.length} media file(s)
                    </p>
                  )}
                  {post.publishes.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {post.publishes.slice(0, 3).map((p) => (
                        <Badge
                          key={p.platform}
                          variant={
                            p.status === "PUBLISHED"
                              ? "success"
                              : p.status === "FAILED"
                              ? "destructive"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {p.platform}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
        {recentPosts.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-12 text-center">
            <p className="text-gray-500">No posts yet.</p>
            <Link href="/import" className="mt-2 block text-sm text-blue-600 hover:underline">
              Import your Facebook posts
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
    PENDING: "secondary",
    PROCESSING: "warning",
    COMPLETED: "success",
    FAILED: "destructive",
  };
  return <Badge variant={map[status] ?? "secondary"}>{status}</Badge>;
}
