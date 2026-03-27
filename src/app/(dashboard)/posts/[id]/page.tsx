"use client";

import { use, useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { PublishPanel } from "@/components/posts/PublishPanel";

interface Media {
  id: string;
  storageKey: string;
  mimeType: string;
  url: string | null;
}

interface PublishRecord {
  id: string;
  platform: string;
  status: string;
  platformUrl: string | null;
  scheduledAt: string | null;
  publishedAt: string | null;
  errorMessage: string | null;
}

interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  media: Media[];
  publishes: PublishRecord[];
}

export default function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);

  const loadPost = async () => {
    const res = await fetch(`/api/posts/${id}`);
    if (res.ok) setPost(await res.json());
    setLoading(false);
  };

  useEffect(() => {
    loadPost();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
        <div className="h-40 animate-pulse rounded-xl bg-gray-200" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Post not found.</p>
        <Link href="/posts" className="mt-2 block text-sm text-blue-600">
          Back to posts
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/posts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <Badge variant="outline">{post.source}</Badge>
        <span className="text-sm text-gray-500">
          {format(new Date(post.originalDate), "MMMM d, yyyy · h:mm a")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Post content */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Content</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm text-gray-700">{post.body}</p>
            </CardContent>
          </Card>

          {/* Media */}
          {post.media.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Media ({post.media.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {post.media.map((m) =>
                    m.url ? (
                      m.mimeType.startsWith("video") ? (
                        // eslint-disable-next-line jsx-a11y/media-has-caption
                        <video
                          key={m.id}
                          src={m.url}
                          controls
                          className="rounded-lg w-full"
                        />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={m.id}
                          src={m.url}
                          alt=""
                          className="rounded-lg w-full object-cover aspect-square"
                        />
                      )
                    ) : null
                  )}
                </div>
              </CardContent>
            </Card>
          )}

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

        {/* Publish Panel */}
        <div>
          <PublishPanel postId={id} onPublished={loadPost} />
        </div>
      </div>
    </div>
  );
}
