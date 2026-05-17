"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";
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
      <Link href="/admin/posts/new">
        <Button size="sm" className="h-9 px-3">
          <Plus className="h-4 w-4 shrink-0" />
          <span className="hidden sm:inline">New</span>
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

