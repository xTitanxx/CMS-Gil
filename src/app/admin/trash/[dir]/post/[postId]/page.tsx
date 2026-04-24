import Link from "next/link";
import { CopyIdChip } from "../../../CopyIdChip";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readTrashedPost } from "@/lib/trash";
import { getSignedDownloadUrl } from "@/lib/storage";
import { displayBody } from "@/lib/post-body";

export const dynamic = "force-dynamic";

export default async function TrashedPostPage({
  params,
}: {
  params: Promise<{ dir: string; postId: string }>;
}) {
  const { dir, postId } = await params;
  const decodedDir = decodeURIComponent(dir);
  const post = await readTrashedPost(decodedDir, postId);
  if (!post) notFound();

  const body = displayBody(post.body);

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      ...m,
      url: await getSignedDownloadUrl(m.storageKey).catch(() => null),
    })),
  );

  return (
    <div>
      <div className="mx-auto mt-3 w-full max-w-4xl space-y-4 px-4">
        <Link
          href="/admin/trash"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to trash
        </Link>

        <div className="flex items-center gap-2">
          <Badge variant="destructive">Trashed</Badge>
          <Badge variant="outline">{post.source}</Badge>
          <span className="text-sm text-gray-500">
            {format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
          </span>
        </div>

        {body ? (
          <div className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-4 text-sm leading-relaxed text-gray-800">
            {body}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 p-4 text-sm italic text-gray-400">
            No caption
          </div>
        )}

        {mediaWithUrls.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Media ({mediaWithUrls.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2">
                {mediaWithUrls.map((m) => (
                  <div
                    key={m.id}
                    className="overflow-hidden rounded-lg border border-gray-200"
                  >
                    {m.url ? (
                      m.mimeType.startsWith("video/") ? (
                        <video
                          src={m.url}
                          controls
                          className="max-h-80 w-full object-contain bg-black"
                        />
                      ) : (
                        <img
                          src={m.url}
                          alt=""
                          className="max-h-80 w-full object-contain"
                        />
                      )
                    ) : (
                      <div className="flex h-40 items-center justify-center bg-gray-100 text-sm text-gray-400">
                        Media unavailable
                      </div>
                    )}
                    <div className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">
                      {m.mimeType}
                      {m.sizeBytes != null && (
                        <span className="ml-2">
                          {(m.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {post.tags.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Tags</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {post.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-sm text-gray-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {post.publishes.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {post.publishes.map((pr, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-sm text-gray-600"
                  >
                    <span className="font-medium">{pr.platform}</span>
                    <Badge
                      variant={
                        pr.status === "PUBLISHED"
                          ? "success"
                          : pr.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {pr.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center gap-2 pb-8 text-xs text-gray-400">
          <span>Post ID:</span>
          <CopyIdChip id={post.id} />
          {post.sourceId && (
            <>
              <span>· Source ID:</span>
              <CopyIdChip id={post.sourceId} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
