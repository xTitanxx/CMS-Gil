"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Sparkles, X, RefreshCw } from "lucide-react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { PostListShell } from "@/app/admin/_shared/PostListShell";
import { ViewToggle } from "./ViewToggle";
import { PostRow, type PostRowData } from "./PostRow";
import { buildFilterParams } from "./PostFilterUI";
import {
  CONTENT_CATEGORIES,
  AUDIO_CATEGORIES,
  type ContentCategory,
  type AudioCategory,
} from "@/lib/posts-query";
import {
  parseCsvToSet,
  LINK_VALUES,
  MULTI_MEDIA_VALUES,
  TAGGED_VALUES,
  SHARE_VALUES,
  QUALITY_VALUES,
  CAPTION_QUALITY_VALUES,
  ENRICHED_VALUES,
  type LinkValue,
  type MultiMediaValue,
  type TaggedValue,
  type ShareValue,
  type QualityValue,
  type CaptionQualityValue,
  type EnrichedValue,
} from "./PostFilterUI";

type KindFilter = "posts" | "stories";

interface AllPostsViewProps {
  initialSearch?: string;
  initialSort?: string;
  initialContent?: string;
  initialAudio?: string;
  initialLink?: string;
  initialMultiMedia?: string;
  initialTagged?: string;
  initialShare?: string;
  initialQuality?: string;
  initialTags?: string[];
  initialKind?: KindFilter;
}

export function AllPostsView(_props: AllPostsViewProps) {
  // Initial props are unused here — PostListShell re-derives state from the URL
  // via `useSearchParams`. Kept in the signature for API compatibility with the
  // page-level prop drilling that's been in place since the posts page shipped.
  void _props;

  const searchParams = useSearchParams();
  const kind: KindFilter = (searchParams.get("kind") === "stories" ? "stories" : "posts");

  const [posts, setPosts] = useState<PostRowData[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const lastSelectedIndexRef = useRef<number | null>(null);

  const bulkDelete = useAsync();
  const bulkAnalyze = useAsync();
  const bulkCaption = useAsync();
  const [analyzeQueued, setAnalyzeQueued] = useState<number | null>(null);
  const [analyzeJob, setAnalyzeJob] = useState<{
    id: string;
    status: "RUNNING" | "CANCELLED" | "DONE";
    total: number;
    completed: number;
  } | null>(null);
  const [captionQueued, setCaptionQueued] = useState<number | null>(null);
  const [captionJob, setCaptionJob] = useState<{
    id: string;
    status: "RUNNING" | "CANCELLED" | "DONE";
    total: number;
    completed: number;
  } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const allSelected = posts.length > 0 && posts.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  function onPostsChanged(next: PostRowData[]) {
    setPosts(next);
    // Clear stale selections for posts no longer visible
    setSelectedIds((prev) => {
      const visible = new Set(next.map((p) => p.id));
      const pruned = new Set<string>();
      prev.forEach((id) => {
        if (visible.has(id)) pruned.add(id);
      });
      return pruned;
    });
    lastSelectedIndexRef.current = null;
  }

  function handleSelectAllToggle(checked: boolean, visiblePosts: PostRowData[]) {
    if (!checked) {
      setSelectedIds(new Set());
      setSelectAllMode(false);
    } else {
      setSelectedIds(new Set(visiblePosts.map((p) => p.id)));
    }
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
      lastSelectedIndexRef.current = index;
    }
  }

  // Rebuild the "back" query string so row links carry the current filters.
  const content = useMemo(() => parseCsvToSet(searchParams.get("content") ?? undefined, CONTENT_CATEGORIES), [searchParams]);
  const audio = useMemo(() => parseCsvToSet(searchParams.get("audio") ?? undefined, AUDIO_CATEGORIES), [searchParams]);
  const link = useMemo(() => parseCsvToSet(searchParams.get("link") ?? undefined, LINK_VALUES), [searchParams]);
  const multiMedia = useMemo(() => parseCsvToSet(searchParams.get("multiMedia") ?? undefined, MULTI_MEDIA_VALUES), [searchParams]);
  const tagged = useMemo(() => parseCsvToSet(searchParams.get("tagged") ?? undefined, TAGGED_VALUES), [searchParams]);
  const share = useMemo(() => parseCsvToSet(searchParams.get("share") ?? undefined, SHARE_VALUES), [searchParams]);
  const quality = useMemo(() => parseCsvToSet(searchParams.get("quality") ?? undefined, QUALITY_VALUES), [searchParams]);
  const captionQuality = useMemo(() => new Set(CAPTION_QUALITY_VALUES) as Set<CaptionQualityValue>, []);
  const enriched = useMemo(() => new Set(ENRICHED_VALUES) as Set<EnrichedValue>, []);
  const search = searchParams.get("search") ?? "";
  const sort = searchParams.get("sort") ?? "originalDate_desc";
  const aiTags = useMemo(() => {
    const t = searchParams.get("tags");
    return t ? t.split(",").filter(Boolean) : [];
  }, [searchParams]);
  const subKindQS = searchParams.get("subKind");
  const subKind = ["all", "video-audio", "video-silent", "photo", "text", "quoted"].includes(
    subKindQS ?? "",
  )
    ? (subKindQS as string)
    : "all";

  const detailQueryString = useMemo(() => {
    return buildFilterParams({
      search,
      sort,
      aiTags,
      content: content as Set<ContentCategory>,
      audio: audio as Set<AudioCategory>,
      link: link as Set<LinkValue>,
      multiMedia: multiMedia as Set<MultiMediaValue>,
      tagged: tagged as Set<TaggedValue>,
      share: share as Set<ShareValue>,
      quality: quality as Set<QualityValue>,
      captionQuality,
      enriched,
      kind,
      subKind: subKind !== "all" ? subKind : undefined,
    }).toString();
  }, [search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind]);

  const postHref = useCallback(
    (id: string) => `/admin/posts/${id}?${detailQueryString}`,
    [detailQueryString],
  );

  // Poll for tagging / caption jobs
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/posts/bulk-analyze");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setAnalyzeJob(data.job ?? null);
      } catch {}
    }
    check();
    const interval = setInterval(() => {
      if (analyzeJob?.status === "RUNNING") check();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [analyzeJob?.status]);

  useEffect(() => {
    let cancelled = false;
    async function checkCaption() {
      try {
        const res = await fetch("/api/posts/bulk-caption-analyze");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setCaptionJob(data.job ?? null);
      } catch {}
    }
    checkCaption();
    const interval = setInterval(() => {
      if (captionJob?.status === "RUNNING") checkCaption();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [captionJob?.status]);

  const handleBulkDelete = useCallback(async () => {
    const count = selectAllMode ? filteredTotal : selectedIds.size;
    await bulkDelete.run(async () => {
      const res = await fetch("/api/posts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selectAllMode ? { all: true, search } : { ids: [...selectedIds] }),
      });
      if (!res.ok) throw new Error("Delete failed");
    }, `Deleted ${count} post${count === 1 ? "" : "s"}`);
    setSelectedIds(new Set());
    setSelectAllMode(false);
    setRefreshToken((n) => n + 1);
  }, [bulkDelete, selectAllMode, filteredTotal, selectedIds, search]);

  const { confirming: bulkConfirming, trigger: triggerBulkDelete } = useConfirm(handleBulkDelete);

  const headerActions = (
    <>
      <ViewToggle />
      <Link href="/admin/trash">
        <Button size="sm" variant="outline">
          <Trash2 className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">Trash</span>
        </Button>
      </Link>
      {analyzeJob?.status === "RUNNING" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await fetch("/api/posts/bulk-analyze", { method: "DELETE" });
            const res = await fetch("/api/posts/bulk-analyze");
            const data = await res.json();
            setAnalyzeJob(data.job ?? null);
          }}
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">
            Cancel tagging ({analyzeJob.completed}/{analyzeJob.total})
          </span>
          <span className="sm:hidden">
            Cancel ({analyzeJob.completed}/{analyzeJob.total})
          </span>
        </Button>
      ) : (
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
              setAnalyzeJob(data.job ?? null);
            });
          }}
        >
          {bulkAnalyze.isLoading ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          <span className="sm:hidden">{bulkAnalyze.isLoading ? "..." : "Tags"}</span>
          <span className="hidden sm:inline">
            {bulkAnalyze.isLoading ? "Starting..." : "AI Tag All"}
          </span>
        </Button>
      )}
      {captionJob?.status === "RUNNING" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            await fetch("/api/posts/bulk-caption-analyze", { method: "DELETE" });
            const res = await fetch("/api/posts/bulk-caption-analyze");
            const data = await res.json();
            setCaptionJob(data.job ?? null);
          }}
        >
          <X className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">
            Cancel captions ({captionJob.completed}/{captionJob.total})
          </span>
          <span className="sm:hidden">
            Cancel ({captionJob.completed}/{captionJob.total})
          </span>
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={bulkCaption.isLoading}
          onClick={async () => {
            await bulkCaption.run(async () => {
              const body = selectedIds.size > 0 ? { postIds: Array.from(selectedIds) } : {};
              const res = await fetch("/api/posts/bulk-caption-analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
              if (!res.ok) throw new Error("Failed to start caption analysis");
              const data = await res.json();
              setCaptionQueued(data.queued);
              setCaptionJob(data.job ?? null);
            });
          }}
        >
          {bulkCaption.isLoading ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          <span className="sm:hidden">{bulkCaption.isLoading ? "..." : "Captions"}</span>
          <span className="hidden sm:inline">
            {bulkCaption.isLoading ? "Starting..." : "Rate Captions"}
          </span>
        </Button>
      )}
      <Link href="/admin/posts/new">
        <Button size="sm">
          <Plus className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">New Post</span>
        </Button>
      </Link>
    </>
  );

  const bulkBar = someSelected ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 md:gap-3 md:px-4">
        <span className="text-sm font-medium text-blue-700">
          {selectAllMode ? filteredTotal : selectedIds.size} selected
          {allSelected && !selectAllMode && filteredTotal > posts.length && (
            <>
              {" "}
              ·{" "}
              <button
                className="underline hover:text-blue-900"
                onClick={() => setSelectAllMode(true)}
              >
                Select all {filteredTotal}
              </button>
            </>
          )}
          {selectAllMode && (
            <>
              {" "}
              ·{" "}
              <button
                className="underline hover:text-blue-900"
                onClick={() => {
                  setSelectAllMode(false);
                  setSelectedIds(new Set());
                }}
              >
                Clear all
              </button>
            </>
          )}
        </span>
        <Button
          size="sm"
          variant={bulkConfirming ? "outline" : "destructive"}
          disabled={bulkDelete.isLoading}
          onClick={triggerBulkDelete}
          className={bulkConfirming ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""}
        >
          {bulkDelete.isLoading ? <Spinner /> : <Trash2 className="h-4 w-4 shrink-0" />}
          {bulkDelete.isLoading ? "Trashing..." : bulkConfirming ? "Sure?" : "Trash"}
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
          {bulkAnalyze.isLoading ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          {bulkAnalyze.isLoading ? "Starting..." : "Tag"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={bulkCaption.isLoading}
          onClick={async () => {
            await bulkCaption.run(async () => {
              const res = await fetch("/api/posts/bulk-caption-analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ postIds: [...selectedIds] }),
              });
              if (!res.ok) throw new Error("Failed");
              const data = await res.json();
              setCaptionQueued(data.queued);
              setCaptionJob(data.job ?? null);
            });
          }}
        >
          {bulkCaption.isLoading ? (
            <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" />
          )}
          {bulkCaption.isLoading ? "Starting..." : "Rate Captions"}
        </Button>
        <button
          className="ml-auto text-sm text-blue-600 hover:underline"
          onClick={() => {
            setSelectedIds(new Set());
            setSelectAllMode(false);
            lastSelectedIndexRef.current = null;
          }}
        >
          Clear
        </button>
      </div>
      {bulkDelete.status === "success" && (
        <p className="text-sm text-green-700 px-1">{bulkDelete.message}</p>
      )}
      {bulkDelete.status === "error" && (
        <p className="text-sm text-red-600 px-1">{bulkDelete.message}</p>
      )}
    </div>
  ) : null;

  const bannerRow = (
    <>
      {analyzeQueued !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-2 text-sm text-purple-800">
          <Sparkles className="h-4 w-4 shrink-0 text-purple-500" />
          {analyzeQueued > 0
            ? `AI tagging started for ${analyzeQueued} untagged posts. Tags will appear as they're processed.`
            : "All posts already have tags."}
        </div>
      )}
      {captionQueued !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
          {captionQueued > 0
            ? `Caption analysis started for ${captionQueued} posts. Phase A rates all captions, Phase B generates rewrite suggestions for low-quality ones.`
            : "All media posts already analyzed."}
        </div>
      )}
    </>
  );

  return (
    <PostListShell<PostRowData>
      apiEndpoint="/api/posts"
      refreshKey={refreshToken}
      title={kind === "stories" ? "All Stories" : "All Posts"}
      itemNoun={{
        singular: kind === "stories" ? "story" : "post",
        plural: kind === "stories" ? "stories" : "posts",
      }}
      headerActions={headerActions}
      beforeList={bannerRow}
      bulkBar={bulkBar}
      getPostId={(p) => p.id}
      showSelectAll
      allSelected={allSelected}
      onSelectAllToggle={handleSelectAllToggle}
      onPostsChanged={onPostsChanged}
      onMetricsChanged={(m) => setFilteredTotal(m.filteredTotal)}
      renderRow={(post, index) => (
        <PostRow
          post={post}
          index={index}
          isSelected={selectedIds.has(post.id)}
          href={postHref(post.id)}
          onCheckboxClick={handleCheckboxClick}
          onDeleted={(id) => {
            setPosts((prev) => prev.filter((p) => p.id !== id));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          }}
        />
      )}
    />
  );
}
