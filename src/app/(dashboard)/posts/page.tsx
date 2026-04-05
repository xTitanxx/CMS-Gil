"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Image as ImageIcon, Trash2 } from "lucide-react";

interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  tags: string[];
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const lastSelectedIndexRef = useRef<number | null>(null);

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
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    lastSelectedIndexRef.current = null;
  }, [page, search]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const allSelected = posts.length > 0 && posts.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(posts.map((p) => p.id)));
    }
    setLastSelectedIndex(null);
    lastSelectedIndexRef.current = null;
  }

  function handleCheckboxClick(e: React.MouseEvent, postId: string, index: number) {
    e.preventDefault();
    e.stopPropagation();

    if (e.shiftKey && lastSelectedIndexRef.current !== null) {
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(posts[i].id);
        }
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(postId)) {
          next.delete(postId);
        } else {
          next.add(postId);
        }
        return next;
      });
      setLastSelectedIndex(index);
      lastSelectedIndexRef.current = index;
    }
  }

  async function handleBulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} post${selectedIds.size === 1 ? "" : "s"}?`)) return;
    setBulkDeleting(true);
    await Promise.all(
      [...selectedIds].map((id) => fetch(`/api/posts/${id}`, { method: "DELETE" }))
    );
    setBulkDeleting(false);
    fetchPosts();
  }

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

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
          <span className="text-sm text-blue-700 font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            size="sm"
            variant="destructive"
            disabled={bulkDeleting}
            onClick={handleBulkDelete}
          >
            <Trash2 className="h-4 w-4" />
            {bulkDeleting ? "Deleting..." : "Delete selected"}
          </Button>
          <button
            className="ml-auto text-sm text-blue-600 hover:underline"
            onClick={() => { setSelectedIds(new Set()); setLastSelectedIndex(null); lastSelectedIndexRef.current = null; }}
          >
            Clear selection
          </button>
        </div>
      )}

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
          {/* Select all row */}
          <div className="flex items-center gap-3 px-2 pb-1">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
            />
            <span className="text-xs text-gray-500">Select all</span>
          </div>

          {posts.map((post, index) => {
            const isSelected = selectedIds.has(post.id);
            return (
              <div
                key={post.id}
                className={`flex items-start gap-3 rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm ${
                  isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200"
                }`}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0 pt-0.5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => handleCheckboxClick(e, post.id, index)}
                    onChange={() => {}}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
                  />
                </div>

                <Link href={`/posts/${post.id}`} className="flex items-start gap-4 flex-1 min-w-0">
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
                    {post.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {post.tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {tag}
                          </span>
                        ))}
                        {post.tags.length > 5 && (
                          <span className="text-xs text-gray-400">+{post.tags.length - 5} more</span>
                        )}
                      </div>
                    )}
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
                </Link>

                {/* Delete button */}
                <button
                  className="ml-2 flex-shrink-0 p-1 text-gray-300 hover:text-red-500 transition-colors"
                  onClick={async (e) => {
                    e.preventDefault();
                    if (!confirm("Delete this post?")) return;
                    await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
                    fetchPosts();
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
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
