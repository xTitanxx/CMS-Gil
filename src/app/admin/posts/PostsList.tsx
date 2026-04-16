"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Search,
  Plus,
  Image as ImageIcon,
  Trash2,
  Sparkles,
  X,
  RefreshCw,
  VolumeX,
  Link as LinkIcon,
  Video,
  Images,
  FileText,
  Send,
} from "lucide-react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { ViewToggle } from "./ViewToggle";
import { KindTabs } from "./KindTabs";
import { SubKindTabs, type SubKindCounts } from "./SubKindTabs";
import { PlatformIcons } from "../scheduled/PlatformIcons";
import { displayBody } from "@/lib/post-body";
import {
  CONTENT_CATEGORIES,
  AUDIO_CATEGORIES,
  type ContentCategory,
  type AudioCategory,
} from "@/lib/posts-query";
import {
  FilterMenu,
  SortMenu,
  JumpToDateMenu,
  parseCsvToSet,
  serializeSet,
  countActiveFilters,
  buildFilterParams,
  LINK_VALUES,
  MULTI_MEDIA_VALUES,
  TAGGED_VALUES,
  SHARE_VALUES,
  QUALITY_VALUES,
  type LinkValue,
  type MultiMediaValue,
  type TaggedValue,
  type ShareValue,
  type QualityValue,
} from "./PostFilterUI";

interface Post {
  id: string;
  body: string;
  source: string;
  postType: string;
  originalDate: string;
  thumbUrl: string | null;
  videoUrl: string | null;
  isVideo: boolean;
  isSilent: boolean;
  tags: string[];
  platformUrl: string | null;
  share: { url?: string; source?: string; name?: string } | null;
  media: { id: string; mimeType: string; hasAudio: boolean | null }[];
  publishes: { platform: string; status: string }[];
  rating: { stars: number } | null;
  captionQuality: number | null;
  captionEvergreen: boolean | null;
  captionSuggestion: string | null;
}

type KindFilter = "posts" | "stories";

// Per-filter-key cache so navigating into a post and back restores the list
// without refetching and keeps the scroll position. Lives at module scope so
// it survives the PostsList unmount that happens during client navigation.
interface ListSnapshot {
  posts: Post[];
  nextCursor: string | null;
  done: boolean;
  total: number;
  filteredTotal: number;
  scrollTop: number;
}
const listCache = new Map<string, ListSnapshot>();

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

// Base64url-encode a cursor client-side to match the server's encodeCursor().
function encodeCursorClient(c: { value: string; id: string }): string {
  const b64 = btoa(JSON.stringify(c));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Build a synthetic cursor that makes the API start streaming posts from a
// chosen calendar date. For desc sort we pivot just after end-of-day so the
// first returned row is the latest post on that day; for asc, just before
// start-of-day so the first row is the earliest post on that day.
function jumpCursorForDate(dateStr: string, sort: string): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  const dir = sort.endsWith("_asc") ? "asc" : "desc";
  if (dir === "desc") {
    const pivot = new Date(d.getTime() + 24 * 60 * 60 * 1000).toISOString();
    return encodeCursorClient({ value: pivot, id: "zzzzzzzzzzzzzzzzzzzzzzzzz" });
  }
  const pivot = new Date(d.getTime() - 1).toISOString();
  return encodeCursorClient({ value: pivot, id: "" });
}

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
      className={`flex-shrink-0 self-center p-1 transition-colors ${
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

const ALL_PLATFORMS = [
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "FACEBOOK_PAGE",
] as const;
const VIDEO_ONLY = new Set(["YOUTUBE", "TIKTOK"]);

function RowPublishAllButton({ post }: { post: Post }) {
  const { isLoading, status, message, run } = useAsync();
  const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
  const targets = ALL_PLATFORMS.filter((p) => hasVideo || !VIDEO_ONLY.has(p));

  const handlePublish = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${post.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platforms: targets }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Publish failed");
      }
    }, `Publishing to ${targets.length} platform${targets.length === 1 ? "" : "s"}`);
  }, [post.id, targets, run]);
  const { confirming, trigger } = useConfirm(handlePublish);

  const tone =
    status === "error"
      ? "text-red-500"
      : status === "success"
      ? "text-green-600"
      : confirming
      ? "text-amber-500"
      : "text-gray-300 hover:text-blue-600";

  return (
    <button
      className={`flex-shrink-0 self-center p-1 transition-colors ${tone}`}
      onClick={(e) => {
        e.preventDefault();
        trigger();
      }}
      title={
        status === "error"
          ? `Error: ${message}`
          : status === "success"
          ? "Publishing started"
          : confirming
          ? `Publish to ${targets.join(", ")}?`
          : `Publish to all (${targets.length})`
      }
    >
      {isLoading ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
    </button>
  );
}

interface PostsListProps {
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

export function PostsList({
  initialSearch = "",
  initialSort = "originalDate_desc",
  initialContent,
  initialAudio,
  initialLink,
  initialMultiMedia,
  initialTagged,
  initialShare,
  initialQuality,
  initialTags = [],
  initialKind = "posts",
}: PostsListProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [kindCounts, setKindCounts] = useState<{ posts: number; stories: number } | null>(null);
  const [subKindCounts, setSubKindCounts] = useState<SubKindCounts | null>(null);
  const [subKindTotals, setSubKindTotals] = useState<SubKindCounts | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [search, setSearch] = useState(initialSearch);
  const [sort, setSort] = useState(initialSort);
  const [content, setContent] = useState<Set<ContentCategory>>(() =>
    parseCsvToSet(initialContent, CONTENT_CATEGORIES)
  );
  const [audio, setAudio] = useState<Set<AudioCategory>>(() =>
    parseCsvToSet(initialAudio, AUDIO_CATEGORIES)
  );
  const [link, setLink] = useState<Set<LinkValue>>(() =>
    parseCsvToSet(initialLink, LINK_VALUES),
  );
  const [multiMedia, setMultiMedia] = useState<Set<MultiMediaValue>>(() =>
    parseCsvToSet(initialMultiMedia, MULTI_MEDIA_VALUES),
  );
  const [tagged, setTagged] = useState<Set<TaggedValue>>(() =>
    parseCsvToSet(initialTagged, TAGGED_VALUES),
  );
  const [share, setShare] = useState<Set<ShareValue>>(() =>
    parseCsvToSet(initialShare, SHARE_VALUES),
  );
  const [quality, setQuality] = useState<Set<QualityValue>>(() =>
    parseCsvToSet(initialQuality, QUALITY_VALUES),
  );
  // When set, the next fetchInitial uses this as the starting cursor (jump-to-date).
  const [jumpCursor, setJumpCursor] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const kindQS = searchParams.get("kind");
  const kind: KindFilter =
    kindQS === "stories" ? "stories" : "posts";
  const subKindQS = searchParams.get("subKind");
  const subKind = ["all", "video-audio", "video-silent", "photo", "text", "quoted"].includes(subKindQS ?? "")
    ? (subKindQS as string)
    : "all";
  void initialKind;
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // Combined search bar state
  const [aiMode, setAiMode] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{ tags: string[]; keywords: string[]; explanation: string } | null>(null);
  const [aiTags, setAiTags] = useState<string[]>(initialTags);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const bulkDelete = useAsync();
  const bulkAnalyze = useAsync();
  const [analyzeQueued, setAnalyzeQueued] = useState<number | null>(null);
  const [analyzeJob, setAnalyzeJob] = useState<{ id: string; status: "RUNNING" | "CANCELLED" | "DONE"; total: number; completed: number } | null>(null);
  const bulkCaption = useAsync();
  const [captionQueued, setCaptionQueued] = useState<number | null>(null);
  const [captionJob, setCaptionJob] = useState<{ id: string; status: "RUNNING" | "CANCELLED" | "DONE"; total: number; completed: number } | null>(null);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isRestoringRef = useRef(false);
  const pendingScrollTargetRef = useRef<number | null>(null);

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
    setAiSearching(false);
  }

  function clearAiSearch() {
    setAiQuery("");
    setAiResult(null);
    setAiTags([]);
    setSearch("");
  }

  function toggleAiMode() {
    if (aiMode) {
      // turning off — clear AI state
      clearAiSearch();
      setAiMode(false);
    } else {
      setAiMode(true);
    }
  }

  const activeFilterCount = useMemo(
    () => countActiveFilters({ sort, content, audio, link, multiMedia, tagged, share, quality }),
    [sort, content, audio, link, multiMedia, tagged, share, quality],
  );

  function resetFilters() {
    setSort("originalDate_desc");
    setContent(new Set(CONTENT_CATEGORIES));
    setAudio(new Set(AUDIO_CATEGORIES));
    setLink(new Set(LINK_VALUES));
    setMultiMedia(new Set(MULTI_MEDIA_VALUES));
    setTagged(new Set(TAGGED_VALUES));
    setShare(new Set(SHARE_VALUES));
    setQuality(new Set(QUALITY_VALUES));
  }

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const params = buildFilterParams({
        search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind, subKind,
      });
      params.set("limit", "20");
      if (sort === "originalDate_desc") params.delete("sort");
      params.set("sort", sort);
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind, subKind],
  );

  const fetchInitial = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    try {
      const params = buildQuery(jumpCursor);
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts ?? []);
      setTotal(data.total ?? 0);
      setFilteredTotal(data.filteredTotal ?? data.total ?? 0);
      if (data.kindCounts) setKindCounts(data.kindCounts);
      if (data.subKindCounts) setSubKindCounts(data.subKindCounts);
      setSubKindTotals(data.subKindTotals ?? null);
      setNextCursor(data.nextCursor ?? null);
      setDone(data.nextCursor == null);
      setSelectedIds(new Set());
      setSelectAllMode(false);
      lastSelectedIndexRef.current = null;
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
      // Consume jump cursor after one fetch — further filter changes refetch
      // from the top, not from the jumped-to date.
      if (jumpCursor) setJumpCursor(null);
    }
  }, [buildQuery, jumpCursor]);

  const fetchMore = useCallback(async () => {
    if (isLoadingRef.current || !nextCursor) return;
    isLoadingRef.current = true;
    setLoadingMore(true);
    try {
      const params = buildQuery(nextCursor);
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts((prev) => [...prev, ...(data.posts ?? [])]);
      setNextCursor(data.nextCursor ?? null);
      setDone(data.nextCursor == null);
    } finally {
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [buildQuery, nextCursor]);

  const cacheKey = useMemo(
    () =>
      buildFilterParams({
        search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind, subKind,
      }).toString(),
    [search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind, subKind],
  );
  const initialisedKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (initialisedKeyRef.current === cacheKey) return;
    initialisedKeyRef.current = cacheKey;
    const cached = listCache.get(cacheKey);
    if (cached && cached.posts.length > 0) {
      // Sync setState inside useLayoutEffect: React re-renders and commits
      // before the browser paints, so the list is populated and scrollTop
      // can be applied without a "flash at top" frame.
      setPosts(cached.posts);
      setNextCursor(cached.nextCursor);
      setDone(cached.done);
      setTotal(cached.total);
      setFilteredTotal(cached.filteredTotal);
      setLoading(false);
      pendingScrollTargetRef.current = cached.scrollTop > 0 ? cached.scrollTop : null;
      if (pendingScrollTargetRef.current != null) {
        isRestoringRef.current = true;
      }
      return;
    }
    fetchInitial();
  }, [cacheKey, fetchInitial]);

  // Drive scroll restoration across layout changes. Runs after every commit
  // until the target is reached (or a timeout elapses). ResizeObserver nudges
  // us whenever late-loading images/videos grow the list.
  useLayoutEffect(() => {
    if (pendingScrollTargetRef.current == null) return;
    const el = findScrollParent(rootRef.current);
    if (!el) return;
    const target = pendingScrollTargetRef.current;
    console.log("[PostsList] restore", { target, now: el.scrollTop, height: el.scrollHeight, client: el.clientHeight });
    const start = performance.now();
    let cancelled = false;

    const apply = () => {
      if (cancelled || pendingScrollTargetRef.current == null) return;
      el.scrollTop = target;
      console.log("[PostsList] apply", { target, actual: el.scrollTop, height: el.scrollHeight });
      if (Math.abs(el.scrollTop - target) < 2) {
        // Hit. Keep isRestoring guard up for a short grace window in case
        // more media loads and the browser nudges scrollTop.
        window.setTimeout(() => {
          pendingScrollTargetRef.current = null;
          isRestoringRef.current = false;
        }, 400);
        return;
      }
      if (performance.now() - start > 5000) {
        pendingScrollTargetRef.current = null;
        isRestoringRef.current = false;
        return;
      }
      requestAnimationFrame(apply);
    };
    requestAnimationFrame(apply);

    const ro = new ResizeObserver(() => {
      if (pendingScrollTargetRef.current != null) {
        el.scrollTop = pendingScrollTargetRef.current;
      }
    });
    ro.observe(el);
    if (rootRef.current) ro.observe(rootRef.current);

    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [posts.length]);

  // Keep the cache fresh as more pages load or filters change.
  useEffect(() => {
    const existing = listCache.get(cacheKey);
    listCache.set(cacheKey, {
      posts,
      nextCursor,
      done,
      total,
      filteredTotal,
      scrollTop: existing?.scrollTop ?? 0,
    });
  }, [cacheKey, posts, nextCursor, done, total, filteredTotal]);

  // Persist scroll position on the admin <main> container.
  useEffect(() => {
    const el = findScrollParent(rootRef.current);
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (isRestoringRef.current) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const snap = listCache.get(cacheKey);
        if (snap) {
          listCache.set(cacheKey, { ...snap, scrollTop: el.scrollTop });
        }
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [cacheKey]);

  // Sync filter state to URL so ViewToggle preserves filters when switching views
  useEffect(() => {
    const params = buildFilterParams({
      search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind,
    });
    const url = new URL(window.location.href);
    // Clear existing filter keys then apply current state
    for (const key of [
      "search", "sort", "tags", "content", "audio", "link",
      "multiMedia", "tagged", "share", "quality", "kind",
    ]) {
      url.searchParams.delete(key);
    }
    params.forEach((v, k) => url.searchParams.set(k, v));
    window.history.replaceState(null, "", url.toString());
  }, [search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind]);

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
    return () => { cancelled = true; clearInterval(interval); };
  }, [captionJob?.status]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !nextCursor) return;
    let root: Element | null = el.parentElement;
    while (root && root !== document.body) {
      const style = getComputedStyle(root);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      root = root.parentElement;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !isLoadingRef.current) {
            fetchMore();
          }
        }
      },
      { root: root && root !== document.body ? root : null, rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, fetchMore]);

  const detailQueryString = useMemo(() => {
    return buildFilterParams({
      search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, kind,
      subKind: subKind !== "all" ? subKind : undefined,
    }).toString();
  }, [search, sort, content, audio, link, multiMedia, tagged, share, quality, aiTags, kind, subKind]);

  const postHref = useCallback(
    (id: string) => `/admin/posts/${id}?${detailQueryString}`,
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

  const handleBulkDelete = useCallback(async () => {
    const count = selectAllMode ? filteredTotal : selectedIds.size;
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
    fetchInitial();
  }, [bulkDelete, selectAllMode, filteredTotal, selectedIds, search, fetchInitial]);

  const { confirming: bulkConfirming, trigger: triggerBulkDelete } = useConfirm(handleBulkDelete);

  return (
    <div className="space-y-4 md:space-y-6" ref={rootRef}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">
            {kind === "stories" ? "All Stories" : "All Posts"}
          </h1>
          <p className="text-sm text-gray-500">
            {filteredTotal < total
              ? `${filteredTotal.toLocaleString()} of ${total.toLocaleString()} ${kind === "stories" ? "stories" : "posts"}`
              : `${total.toLocaleString()} ${kind === "stories" ? "stories" : "posts"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              <span className="hidden sm:inline">Cancel tagging ({analyzeJob.completed}/{analyzeJob.total})</span>
              <span className="sm:hidden">Cancel ({analyzeJob.completed}/{analyzeJob.total})</span>
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
              {bulkAnalyze.isLoading ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">{bulkAnalyze.isLoading ? "Starting..." : "AI Tag All"}</span>
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
              <span className="hidden sm:inline">Cancel captions ({captionJob.completed}/{captionJob.total})</span>
              <span className="sm:hidden">Cancel ({captionJob.completed}/{captionJob.total})</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={bulkCaption.isLoading}
              onClick={async () => {
                await bulkCaption.run(async () => {
                  const body = selectedIds.size > 0
                    ? { postIds: Array.from(selectedIds) }
                    : {};
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
              {bulkCaption.isLoading ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="h-4 w-4 shrink-0" />}
              <span className="hidden sm:inline">{bulkCaption.isLoading ? "Starting..." : selectedIds.size > 0 ? `Caption (${selectedIds.size})` : "Caption All"}</span>
            </Button>
          )}
          <Link href="/admin/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">New Post</span>
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

      {captionQueued !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
          {captionQueued > 0
            ? `Caption analysis started for ${captionQueued} posts. Phase A rates all captions, Phase B generates rewrite suggestions for low-quality ones.`
            : "All media posts already analyzed."}
        </div>
      )}

      <KindTabs current={kind} counts={kindCounts} />
      <SubKindTabs kind={kind} current={subKind} counts={subKindCounts} totals={subKindTotals} />

      {/* Combined search + filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1" style={{ minWidth: "160px" }}>
            {aiMode ? (
              <Sparkles className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-purple-500" />
            ) : (
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            )}
            <input
              type="text"
              placeholder={aiMode ? "AI search — describe what you're looking for..." : "Search posts..."}
              value={aiMode ? aiQuery : search}
              onChange={(e) => {
                if (aiMode) {
                  setAiQuery(e.target.value);
                } else {
                  setSearch(e.target.value);
                  setAiTags([]);
                  setAiResult(null);
                }
              }}
              onKeyDown={(e) => {
                if (aiMode && e.key === "Enter") runAiSearch();
              }}
              className={`w-full rounded-lg border bg-white py-2 pl-10 pr-11 text-sm focus:outline-none ${
                aiMode
                  ? "border-purple-300 focus:border-purple-500"
                  : "border-gray-300 focus:border-blue-500"
              }`}
            />
            <button
              type="button"
              onClick={toggleAiMode}
              title={aiMode ? "Switch to keyword search" : "Switch to AI search"}
              aria-pressed={aiMode}
              className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 transition-all ${
                aiMode
                  ? "bg-purple-100 text-purple-600 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                  : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              }`}
            >
              <Sparkles className="h-4 w-4" />
            </button>
          </div>
          {aiMode && (
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
          )}
          {aiResult && (
            <Button variant="ghost" size="sm" onClick={clearAiSearch}>
              <X className="h-4 w-4" />
              Clear
            </Button>
          )}
          <SortMenu sort={sort} setSort={setSort} />
          <JumpToDateMenu
            onJump={(dateStr) => {
              const c = jumpCursorForDate(dateStr, sort);
              setJumpCursor(c);
            }}
          />
          <FilterMenu
            content={content}
            setContent={setContent}
            audio={audio}
            setAudio={setAudio}
            link={link}
            setLink={setLink}
            multiMedia={multiMedia}
            setMultiMedia={setMultiMedia}
            tagged={tagged}
            setTagged={setTagged}
            share={share}
            setShare={setShare}
            quality={quality}
            setQuality={setQuality}
            activeCount={activeFilterCount}
            onReset={resetFilters}
          />
        </div>

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
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 md:gap-3 md:px-4">
            <span className="text-sm font-medium text-blue-700">
              {selectAllMode ? filteredTotal : selectedIds.size} selected
            </span>
            <Button
              size="sm"
              variant={bulkConfirming ? "outline" : "destructive"}
              disabled={bulkDelete.isLoading}
              onClick={triggerBulkDelete}
              className={bulkConfirming ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""}
            >
              {bulkDelete.isLoading ? <Spinner /> : <Trash2 className="h-4 w-4 shrink-0" />}
              {bulkDelete.isLoading
                ? "Deleting..."
                : bulkConfirming
                ? "Sure?"
                : "Delete"}
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
              {bulkAnalyze.isLoading ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin" /> : <Sparkles className="h-4 w-4 shrink-0" />}
              {bulkAnalyze.isLoading ? "Starting..." : "Tag"}
            </Button>
            <button
              className="ml-auto text-sm text-blue-600 hover:underline"
              onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false); lastSelectedIndexRef.current = null; }}
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
          {allSelected && !selectAllMode && filteredTotal > posts.length && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              All {posts.length} posts on this page are selected.{" "}
              <button
                className="font-medium underline hover:text-blue-900"
                onClick={() => setSelectAllMode(true)}
              >
                Select all {filteredTotal} posts
              </button>
            </div>
          )}
          {selectAllMode && (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              All {filteredTotal} posts are selected.{" "}
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
          <Link href="/admin/import" className="mt-2 block text-sm text-blue-600 hover:underline">
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
                className={`flex items-start gap-2 rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm md:items-center md:gap-3 md:p-4 ${
                  isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200"
                }`}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0 pt-1 md:pt-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => handleCheckboxClick(e, post.id, index)}
                    onChange={() => {}}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
                  />
                </div>

                <Link href={postHref(post.id)} className="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4">
                  {/* Thumbnail */}
                  <div
                    className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-gray-100 md:h-28 md:w-28"
                    onClick={(e) => {
                      if (post.isVideo && post.videoUrl) e.preventDefault();
                    }}
                  >
                    {post.isVideo && post.videoUrl ? (
                      <video
                        src={post.videoUrl}
                        poster={post.thumbUrl ?? undefined}
                        controls
                        preload="metadata"
                        playsInline
                        className="h-full w-full object-cover"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : post.thumbUrl ? (
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
                    <div className="flex flex-wrap items-center gap-1 md:gap-2">
                      <span
                        className="cursor-pointer rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-400 hover:text-gray-600"
                        title={`#${index + 1} — ID: ${post.id} — click to copy ID`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          navigator.clipboard.writeText(post.id);
                        }}
                      >
                        #{index + 1}
                      </span>
                      <span className="text-xs text-gray-400">
                        {format(new Date(post.originalDate), "MMM d, yyyy")}
                        <span className="hidden sm:inline"> · {format(new Date(post.originalDate), "h:mm a")}</span>
                      </span>
                      {post.rating && (
                        <span className="text-yellow-500 text-xs" title={`${post.rating.stars}/5`}>
                          {"★".repeat(post.rating.stars)}
                        </span>
                      )}
                      {post.captionQuality != null && (
                        <span
                          className={`text-xs rounded px-1 py-0.5 ${
                            post.captionQuality >= 4
                              ? "bg-green-100 text-green-700"
                              : post.captionQuality <= 2
                                ? "bg-amber-100 text-amber-700"
                                : "bg-gray-100 text-gray-600"
                          }`}
                          title={`Caption quality: ${post.captionQuality}/5${post.captionEvergreen === false ? " · non-evergreen" : ""}${post.captionSuggestion ? " · has suggestion" : ""}`}
                        >
                          C{post.captionQuality}
                          {post.captionEvergreen === false && "⏳"}
                          {post.captionSuggestion && "✨"}
                        </span>
                      )}
                      {(() => {
                        const label = post.postType && post.postType !== "POST"
                          ? post.postType.charAt(0) + post.postType.slice(1).toLowerCase()
                          : "Post";
                        return post.platformUrl ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              window.open(post.platformUrl!, "_blank", "noopener,noreferrer");
                            }}
                            className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                            title="Open original on Facebook"
                          >
                            {label}
                          </button>
                        ) : (
                          <Badge variant="outline" className="text-xs">
                            {label}
                          </Badge>
                        );
                      })()}
                      {(() => {
                        const hasVideo = post.media.some((m) => m.mimeType.startsWith("video/"));
                        const hasImage = post.media.some((m) => m.mimeType.startsWith("image/"));
                        const count = post.media.length;
                        if (count === 0) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                              <FileText className="h-3 w-3 shrink-0" />
                              <span className="hidden sm:inline">Text only</span>
                            </span>
                          );
                        }
                        if (hasVideo) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                              <Video className="h-3 w-3 shrink-0" />
                              Video{count > 1 ? ` +${count - 1}` : ""}
                            </span>
                          );
                        }
                        if (count > 1) {
                          return (
                            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                              <Images className="h-3 w-3 shrink-0" />
                              {count} images
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            <ImageIcon className="h-3 w-3 shrink-0" />
                            Image
                          </span>
                        );
                      })()}
                      {post.share && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                          title={
                            post.share.url
                              ? `Quoted post: ${post.share.url}`
                              : "Quoted a Facebook post (share card not preserved by export)"
                          }
                        >
                          <LinkIcon className="h-3 w-3 shrink-0" />
                          <span className="hidden sm:inline">{post.share.url ? "Shared link" : "Quoted FB post"}</span>
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
                    {(() => { const visibleTags = post.tags; return visibleTags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {visibleTags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline-block"
                          >
                            {tag}
                          </span>
                        ))}
                        {/* On mobile show just the count */}
                        {visibleTags.length > 0 && (
                          <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:hidden">
                            {visibleTags.length} tags
                          </span>
                        )}
                        {visibleTags.length > 3 && (
                          <span className="hidden text-xs text-gray-400 sm:inline">+{visibleTags.length - 3} more</span>
                        )}
                      </div>
                    ) : null; })()}
                  </div>

                  {/* Published platforms — hide on mobile to save space */}
                  <PlatformIcons
                    platforms={[
                      ...new Set(
                        post.publishes
                          .filter((p) => p.status === "PUBLISHED")
                          .map((p) => p.platform),
                      ),
                    ]}
                    size={16}
                    className="hidden flex-shrink-0 gap-1.5 md:flex"
                  />
                </Link>

                {/* Row actions */}
                <RowPublishAllButton post={post} />
                <RowDeleteButton
                  postId={post.id}
                  onDeleted={() => {
                    setPosts((prev) => prev.filter((p) => p.id !== post.id));
                    setTotal((t) => Math.max(0, t - 1));
                    setFilteredTotal((t) => Math.max(0, t - 1));
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      next.delete(post.id);
                      return next;
                    });
                  }}
                />
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Infinite scroll sentinel + end-of-feed */}
      {posts.length > 0 && loadingMore && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      )}
      {posts.length > 0 && done && (
        <p className="py-6 text-center text-sm text-gray-400">
          End of list — {posts.length} of {filteredTotal.toLocaleString()} posts
        </p>
      )}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </div>
  );
}
