"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Plus, Image as ImageIcon, Trash2, Sparkles, X, RefreshCw, Play, VolumeX } from "lucide-react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { ViewToggle } from "./ViewToggle";
import { displayBody } from "@/lib/post-body";

interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  isVideo: boolean;
  isSilent: boolean;
  tags: string[];
  media: { id: string; mimeType: string; hasAudio: boolean | null }[];
  publishes: { platform: string; status: string }[];
  analytics: {
    reactions: number | null;
    comments: number | null;
    shares: number | null;
    platformPostId: string | null;
  }[];
}

type AudioFilter = "all" | "audible" | "silent" | "hide-silent";

function RowDeleteButton({
  postId,
  onDeleted,
}: {
  postId: string;
  onDeleted: () => void;
}) {
  const { isLoading, run } = useAsync();
  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    onDeleted();
  }, [postId, run, onDeleted]);
  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <button
      className={`ml-2 flex-shrink-0 p-1 transition-colors ${
        confirming
          ? "text-amber-500"
          : "text-gray-300 hover:text-red-500"
      }`}
      onClick={(e) => {
        e.preventDefault();
        trigger();
      }}
      title={confirming ? "Click again to confirm" : "Delete post"}
    >
      {isLoading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}

interface PostsListProps {
  initialSearch?: string;
  initialSort?: string;
  initialAudio?: AudioFilter;
  initialTags?: string[];
}

export function PostsList({
  initialSearch = "",
  initialSort = "originalDate_desc",
  initialAudio = "all",
  initialTags = [],
}: PostsListProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState(initialSort);
  const [audio, setAudio] = useState<AudioFilter>(initialAudio);
  const [loading, setLoading] = useState(true);
  // AI search
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{ tags: string[]; keywords: string[]; explanation: string } | null>(null);
  const [aiTags, setAiTags] = useState<string[]>(initialTags);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const bulkDelete = useAsync();
  const [lastBulkCount, setLastBulkCount] = useState(0);
  const bulkAnalyze = useAsync();
  const [analyzeQueued, setAnalyzeQueued] = useState<number | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);

  async function runAiSearch() {
    if (!aiQuery.trim()) return;
    setAiSearching(true);
    const res = await fetch("/api/posts/ai-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: aiQuery }),
    });
    const data = await res.json();
    setAiResult(data);
    setAiTags(data.tags ?? []);
    if (data.keywords?.[0]) setSearch(data.keywords[0]);
    setPage(1);
    setAiSearching(false);
  }

  function clearAiSearch() {
    setAiQuery("");
    setAiResult(null);
    setAiTags([]);
    setSearch("");
    setPage(1);
  }

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      limit: "20",
      sort,
      ...(search ? { search } : {}),
      ...(aiTags.length > 0 ? { tags: aiTags.join(",") } : {}),
      ...(audio !== "all" ? { audio } : {}),
    });
    const res = await fetch(`/api/posts?${params}`);
    const data = await res.json();
    setPosts(data.posts ?? []);
    setTotal(data.total ?? 0);
    setPages(data.pages ?? 1);
    setLoading(false);
    setSelectedIds(new Set());
    setSelectAllMode(false);
    setLastSelectedIndex(null);
    lastSelectedIndexRef.current = null;
  }, [page, search, sort, aiTags, audio]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const detailQueryString = useMemo(() => {
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (sort && sort !== "originalDate_desc") qs.set("sort", sort);
    if (audio !== "all") qs.set("audio", audio);
    if (aiTags.length > 0) qs.set("tags", aiTags.join(","));
    return qs.toString();
  }, [search, sort, audio, aiTags]);

  const postHref = useCallback(
    (id: string) => `/posts/${id}?${detailQueryString}`,
    [detailQueryString],
  );

  const allSelected = posts.length > 0 && posts.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected || selectAllMode) {
      setSelectedIds(new Set());
      setSelectAllMode(false);
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

  const handleBulkDelete = useCallback(async () => {
    const count = selectAllMode ? total : selectedIds.size;
    setLastBulkCount(count);
    await bulkDelete.run(async () => {
      const res = await fetch("/api/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          selectAllMode
            ? { all: true, search }
            : { ids: [...selectedIds] }
        ),
      });
      if (!res.ok) throw new Error("Delete failed");
    }, `Deleted ${count} post${count === 1 ? "" : "s"}`);
    fetchPosts();
  }, [bulkDelete, selectAllMode, total, selectedIds, search, fetchPosts]);

  const { confirming: bulkConfirming, trigger: triggerBulkDelete } = useConfirm(handleBulkDelete);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Posts</h1>
          <p className="text-sm text-gray-500">{total} posts total</p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Button
            size="sm"
            variant="outline"
            disabled={bulkAnalyze.isLoading}
            onClick={async () => {
              await bulkAnalyze.run(async () => {
                const res = await fetch("/api/posts/bulk-analyze", { method: "POST" });
                if (!res.ok) throw new Error("Failed to start analysis");
                const data = await res.json();
                setAnalyzeQueued(data.queued);
              });
            }}
          >
            {bulkAnalyze.isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {bulkAnalyze.isLoading ? "Starting..." : "AI Tag All"}
          </Button>
          <Link href="/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      {analyzeQueued !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-800">
          <Sparkles className="h-4 w-4 shrink-0 text-purple-500" />
          {analyzeQueued > 0
            ? `AI tagging started for ${analyzeQueued} untagged posts. Tags will appear as they're processed.`
            : "All posts already have tags."}
        </div>
      )}

      {/* Search + Sort */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search posts..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setAiTags([]);
                setAiResult(null);
                setPage(1);
              }}
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => { setSort(e.target.value); setPage(1); }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value="originalDate_desc">Post date (newest)</option>
            <option value="originalDate_asc">Post date (oldest)</option>
            <option value="createdAt_desc">Import date (newest)</option>
            <option value="createdAt_asc">Import date (oldest)</option>
          </select>
          <select
            value={audio}
            onChange={(e) => { setAudio(e.target.value as AudioFilter); setPage(1); }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            title="Filter by audio track"
          >
            <option value="all">All posts</option>
            <option value="audible">Has audio</option>
            <option value="silent">Silent videos only</option>
            <option value="hide-silent">Hide silent</option>
          </select>
        </div>

        {/* AI Search */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Sparkles className="absolute left-3 top-2.5 h-4 w-4 text-purple-400" />
            <input
              type="text"
              placeholder="AI search — describe what you're looking for..."
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAiSearch()}
              className="w-full rounded-lg border border-purple-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-purple-400 focus:outline-none"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={runAiSearch}
            disabled={aiSearching || !aiQuery.trim()}
            className="border-purple-200 text-purple-700 hover:bg-purple-50"
          >
            {aiSearching ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Search
          </Button>
          {aiResult && (
            <Button variant="ghost" size="sm" onClick={clearAiSearch}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {/* AI result explanation + matched tags */}
        {aiResult && (
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-2 text-sm space-y-1">
            {aiResult.explanation && (
              <p className="text-purple-700">{aiResult.explanation}</p>
            )}
            {aiResult.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {aiResult.tags.map((tag) => (
                  <span key={tag} className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {someSelected && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2">
            <span className="text-sm text-blue-700 font-medium">
              {selectAllMode ? total : selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant={bulkConfirming ? "outline" : "destructive"}
              disabled={bulkDelete.isLoading}
              onClick={triggerBulkDelete}
              className={bulkConfirming ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""}
            >
              {bulkDelete.isLoading ? <Spinner /> : <Trash2 className="h-4 w-4" />}
              {bulkDelete.isLoading
                ? "Deleting..."
                : bulkConfirming
                ? "Are you sure?"
                : "Delete selected"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkAnalyze.isLoading}
              onClick={async () => {
                await bulkAnalyze.run(async () => {
                  const res = await fetch("/api/posts/bulk-analyze", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ postIds: [...selectedIds] }),
                  });
                  if (!res.ok) throw new Error("Failed to start analysis");
                  const data = await res.json();
                  setAnalyzeQueued(data.queued);
                });
              }}
            >
              {bulkAnalyze.isLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {bulkAnalyze.isLoading ? "Starting..." : "Tag selected"}
            </Button>
            <button
              className="ml-auto text-sm text-blue-600 hover:underline"
              onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false); setLastSelectedIndex(null); lastSelectedIndexRef.current = null; }}
            >
              Clear selection
            </button>
          </div>
          {bulkDelete.status === "success" && (
            <p className="text-sm text-green-700 px-1">{bulkDelete.message}</p>
          )}
          {bulkDelete.status === "error" && (
            <p className="text-sm text-red-600 px-1">{bulkDelete.message}</p>
          )}
          {allSelected && !selectAllMode && total > posts.length && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              All {posts.length} posts on this page are selected.{" "}
              <button
                className="font-medium underline hover:text-blue-900"
                onClick={() => setSelectAllMode(true)}
              >
                Select all {total} posts
              </button>
            </div>
          )}
          {selectAllMode && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              All {total} posts are selected.{" "}
              <button
                className="font-medium underline hover:text-blue-900"
                onClick={() => { setSelectAllMode(false); setSelectedIds(new Set()); }}
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}

      {/* Posts list */}
      {loading && posts.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : !loading && posts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
          <p className="text-gray-500">No posts found.</p>
          <Link href="/import" className="mt-2 block text-sm text-blue-600 hover:underline">
            Import posts
          </Link>
        </div>
      ) : (
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60">
              <Spinner className="h-6 w-6 text-gray-400" />
            </div>
          )}
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

                <Link href={postHref(post.id)} className="flex items-start gap-4 flex-1 min-w-0">
                  {/* Thumbnail */}
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-gray-100">
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
                    {post.isVideo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Play className="h-5 w-5 fill-white text-white" />
                      </div>
                    )}
                    {post.isSilent && (
                      <div
                        className="absolute bottom-0.5 right-0.5 rounded-full bg-black/60 p-0.5"
                        title="Silent video — no audio track"
                      >
                        <VolumeX className="h-3 w-3 text-white" />
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
                    {displayBody(post.body) ? (
                      <p className="mt-1 line-clamp-2 text-sm text-gray-700">
                        {displayBody(post.body)}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm italic text-gray-400">No caption</p>
                    )}
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
                    {post.source === "FACEBOOK" &&
                      post.analytics?.[0]?.platformPostId && (
                        <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-400">
                          {post.analytics[0].reactions !== null && (
                            <span>❤ {post.analytics[0].reactions}</span>
                          )}
                          {post.analytics[0].comments !== null && (
                            <span>💬 {post.analytics[0].comments}</span>
                          )}
                          {post.analytics[0].shares !== null && (
                            <span>↗ {post.analytics[0].shares}</span>
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
                <RowDeleteButton postId={post.id} onDeleted={fetchPosts} />
              </div>
            );
          })}
          </div>
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
