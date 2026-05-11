"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Sparkles, RefreshCw, MoreHorizontal } from "lucide-react";
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

  const startAnalyze = useCallback(async () => {
    await bulkAnalyze.run(async () => {
      const res = await fetch("/api/posts/bulk-analyze", { method: "POST" });
      if (!res.ok) throw new Error("Failed to start analysis");
      const data = await res.json();
      setAnalyzeQueued(data.queued);
      setAnalyzeJob(data.job ?? null);
    });
  }, [bulkAnalyze]);

  const cancelAnalyze = useCallback(async () => {
    await fetch("/api/posts/bulk-analyze", { method: "DELETE" });
    const res = await fetch("/api/posts/bulk-analyze");
    const data = await res.json();
    setAnalyzeJob(data.job ?? null);
  }, []);

  const startCaption = useCallback(async () => {
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
  }, [bulkCaption, selectedIds]);

  const cancelCaption = useCallback(async () => {
    await fetch("/api/posts/bulk-caption-analyze", { method: "DELETE" });
    const res = await fetch("/api/posts/bulk-caption-analyze");
    const data = await res.json();
    setCaptionJob(data.job ?? null);
  }, []);

  const headerActions = (
    <>
      <div className="inline-flex shrink-0 items-center rounded-md border border-gray-200 bg-white">
        <ViewToggle className="rounded-none border-0" />
        <div className="w-px self-stretch bg-gray-200" />
        <ActionsMenu
          embedded
          analyzeRunning={analyzeJob?.status === "RUNNING"}
          analyzeProgress={analyzeJob ? `${analyzeJob.completed}/${analyzeJob.total}` : null}
          analyzeStarting={bulkAnalyze.isLoading}
          onStartAnalyze={startAnalyze}
          onCancelAnalyze={cancelAnalyze}
          captionRunning={captionJob?.status === "RUNNING"}
          captionProgress={captionJob ? `${captionJob.completed}/${captionJob.total}` : null}
          captionStarting={bulkCaption.isLoading}
          onStartCaption={startCaption}
          onCancelCaption={cancelCaption}
        />
      </div>
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

interface ActionsMenuProps {
  embedded?: boolean;
  analyzeRunning: boolean;
  analyzeProgress: string | null;
  analyzeStarting: boolean;
  onStartAnalyze: () => void;
  onCancelAnalyze: () => void;
  captionRunning: boolean;
  captionProgress: string | null;
  captionStarting: boolean;
  onStartCaption: () => void;
  onCancelCaption: () => void;
}

function ActionsMenu(props: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const anyRunning = props.analyzeRunning || props.captionRunning;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        title="More actions"
        className={`relative inline-flex h-9 w-9 items-center justify-center text-gray-600 transition-colors hover:bg-gray-50 ${
          props.embedded
            ? `rounded-r-md ${open ? "bg-gray-50" : ""}`
            : `rounded-md border border-gray-200 bg-white ${open ? "bg-gray-50" : ""}`
        }`}
      >
        <MoreHorizontal className="h-4 w-4" />
        {anyRunning && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-purple-500 ring-2 ring-white" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-60 max-w-[calc(100vw-1rem)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
          <ActionRow
            icon={
              props.analyzeRunning || props.analyzeStarting ? (
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-purple-500" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0 text-purple-500" />
              )
            }
            label={
              props.analyzeRunning
                ? `Tagging ${props.analyzeProgress}`
                : props.analyzeStarting
                  ? "Starting…"
                  : "AI tag all"
            }
            trailing={
              props.analyzeRunning ? (
                <span className="text-xs font-medium text-red-500">Cancel</span>
              ) : null
            }
            onClick={() => {
              if (props.analyzeRunning) {
                props.onCancelAnalyze();
              } else if (!props.analyzeStarting) {
                props.onStartAnalyze();
              }
              setOpen(false);
            }}
          />
          <ActionRow
            icon={
              props.captionRunning || props.captionStarting ? (
                <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
              ) : (
                <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
              )
            }
            label={
              props.captionRunning
                ? `Rating ${props.captionProgress}`
                : props.captionStarting
                  ? "Starting…"
                  : "Rate captions"
            }
            trailing={
              props.captionRunning ? (
                <span className="text-xs font-medium text-red-500">Cancel</span>
              ) : null
            }
            onClick={() => {
              if (props.captionRunning) {
                props.onCancelCaption();
              } else if (!props.captionStarting) {
                props.onStartCaption();
              }
              setOpen(false);
            }}
          />
          <div className="border-t border-gray-100" />
          <Link
            href="/admin/trash"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Trash2 className="h-4 w-4 shrink-0 text-gray-400" />
            <span>Open trash</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function ActionRow({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50"
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}
