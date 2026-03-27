"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Image as ImageIcon } from "lucide-react";

interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  media: { id: string; mimeType: string }[];
  publishes: { platform: string; status: string }[];
}

export default function PostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      ...(search ? { search } : {}),
    });
    const res = await fetch(`/api/posts?${params}`);
    const data = await res.json();
    setPosts(data.posts ?? []);
    setTotal(data.total ?? 0);
    setPages(data.pages ?? 1);
    setLoading(false);
  }, [page, search]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Posts</h1>
          <p className="text-sm text-gray-500">{total} posts total</p>
        </div>
        <Link href="/posts/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            New Post
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        <input
          type="text"
          placeholder="Search posts..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none"
        />
      </div>

      {/* Posts list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-500">No posts found.</p>
          <Link href="/import" className="mt-2 block text-sm text-blue-600 hover:underline">
            Import posts
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {posts.map((post) => (
            <Link key={post.id} href={`/posts/${post.id}`}>
              <div className="flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-sm cursor-pointer">
                {/* Thumbnail */}
                <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {post.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-gray-300" />
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">
                      {format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {post.source}
                    </Badge>
                    {post.media.length > 0 && (
                      <span className="text-xs text-gray-400">
                        {post.media.length} media
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-700">{post.body}</p>
                </div>

                {/* Publish status */}
                {post.publishes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {post.publishes.map((p) => (
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
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
