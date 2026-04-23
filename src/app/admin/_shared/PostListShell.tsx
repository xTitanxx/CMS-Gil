"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Search, Sparkles, X, RefreshCw } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { KindTabs } from "@/app/admin/posts/KindTabs";
import { SubKindTabs, type SubKindCounts } from "@/app/admin/posts/SubKindTabs";
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
  countActiveFilters,
  buildFilterParams,
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
} from "@/app/admin/posts/PostFilterUI";
import type { KindFilter, ListApiResponse, PostListShellProps } from "./PostListShell.types";

interface ListSnapshot<TPost> {
  posts: TPost[];
  nextCursor: string | null;
  done: boolean;
  total: number;
  filteredTotal: number;
  scrollTop: number;
}

// Module-level cache keyed by `${apiEndpoint}::${paramString}` so consumers
// don't collide.
const listCache = new Map<string, ListSnapshot<unknown>>();

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY)) return node;
    node = node.parentElement;
  }
  return null;
}

function encodeCursorClient(c: { value: string; id: string }): string {
  const b64 = btoa(JSON.stringify(c));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

export function PostListShell<TPost>(props: PostListShellProps<TPost>) {
  const {
    apiEndpoint,
    extraParams,
    title,
    itemNoun,
    headerActions,
    beforeList,
    bulkBar,
    emptyState,
    renderRow,
    hideKindTabs,
    showSelectAll,
    onSelectAllToggle,
    allSelected,
    onPostsChanged,
    getPostId,
  } = props;

  const searchParams = useSearchParams();
  const kindQS = searchParams.get("kind");
  const kind: KindFilter = kindQS === "stories" ? "stories" : "posts";
  const subKindQS = searchParams.get("subKind");
  const subKind = ["all", "video-audio", "video-silent", "photo", "text", "quoted"].includes(
    subKindQS ?? "",
  )
    ? (subKindQS as string)
    : "all";

  const initialSearch = searchParams.get("search") ?? "";
  const initialSort = searchParams.get("sort") ?? "originalDate_desc";
  const initialTagsParam = searchParams.get("tags");
  const initialTags = initialTagsParam ? initialTagsParam.split(",").filter(Boolean) : [];

  const [posts, setPosts] = useState<TPost[]>([]);
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
    parseCsvToSet(searchParams.get("content") ?? undefined, CONTENT_CATEGORIES),
  );
  const [audio, setAudio] = useState<Set<AudioCategory>>(() =>
    parseCsvToSet(searchParams.get("audio") ?? undefined, AUDIO_CATEGORIES),
  );
  const [link, setLink] = useState<Set<LinkValue>>(() =>
    parseCsvToSet(searchParams.get("link") ?? undefined, LINK_VALUES),
  );
  const [multiMedia, setMultiMedia] = useState<Set<MultiMediaValue>>(() =>
    parseCsvToSet(searchParams.get("multiMedia") ?? undefined, MULTI_MEDIA_VALUES),
  );
  const [tagged, setTagged] = useState<Set<TaggedValue>>(() =>
    parseCsvToSet(searchParams.get("tagged") ?? undefined, TAGGED_VALUES),
  );
  const [share, setShare] = useState<Set<ShareValue>>(() =>
    parseCsvToSet(searchParams.get("share") ?? undefined, SHARE_VALUES),
  );
  const [quality, setQuality] = useState<Set<QualityValue>>(() =>
    parseCsvToSet(searchParams.get("quality") ?? undefined, QUALITY_VALUES),
  );
  const [captionQuality, setCaptionQuality] = useState<Set<CaptionQualityValue>>(
    () => new Set(CAPTION_QUALITY_VALUES),
  );
  const [enriched, setEnriched] = useState<Set<EnrichedValue>>(() => new Set(ENRICHED_VALUES));
  const [jumpCursor, setJumpCursor] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // AI search state
  const [aiMode, setAiMode] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{ tags: string[]; keywords: string[]; explanation: string } | null>(null);
  const [aiTags, setAiTags] = useState<string[]>(initialTags);

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
      clearAiSearch();
      setAiMode(false);
    } else {
      setAiMode(true);
    }
  }

  const activeFilterCount = useMemo(
    () =>
      countActiveFilters({
        sort,
        content,
        audio,
        link,
        multiMedia,
        tagged,
        share,
        quality,
        captionQuality,
        enriched,
      }),
    [sort, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched],
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
    setCaptionQuality(new Set(CAPTION_QUALITY_VALUES));
    setEnriched(new Set(ENRICHED_VALUES));
  }

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const params = buildFilterParams({
        search,
        sort,
        aiTags,
        content,
        audio,
        link,
        multiMedia,
        tagged,
        share,
        quality,
        captionQuality,
        enriched,
        kind,
        subKind,
      });
      params.set("limit", "20");
      if (cursor) params.set("cursor", cursor);
      if (extraParams) {
        for (const [k, v] of Object.entries(extraParams)) {
          if (v) params.set(k, v);
        }
      }
      return params;
    },
    [
      search,
      sort,
      aiTags,
      content,
      audio,
      link,
      multiMedia,
      tagged,
      share,
      quality,
      captionQuality,
      enriched,
      kind,
      subKind,
      extraParams,
    ],
  );

  const fetchInitial = useCallback(
    async (retryCount = 0) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setLoading(true);
      setFetchError(null);
      try {
        const params = buildQuery(jumpCursor);
        const res = await fetch(`${apiEndpoint}?${params}`);
        if (!res.ok) {
          if (retryCount < 3) {
            isLoadingRef.current = false;
            await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retryCount)));
            return fetchInitial(retryCount + 1);
          }
          setFetchError("Failed to load. Server may be temporarily unavailable.");
          return;
        }
        const data = (await res.json()) as ListApiResponse<TPost>;
        setPosts(data.posts ?? []);
        setTotal(data.total ?? 0);
        setFilteredTotal(data.filteredTotal ?? data.total ?? 0);
        if (data.kindCounts) setKindCounts(data.kindCounts);
        if (data.subKindCounts) setSubKindCounts(data.subKindCounts as SubKindCounts);
        setSubKindTotals((data.subKindTotals as SubKindCounts | undefined) ?? null);
        setNextCursor(data.nextCursor ?? null);
        setDone(data.nextCursor == null);
        onPostsChanged?.(data.posts ?? []);
      } catch {
        if (retryCount < 3) {
          isLoadingRef.current = false;
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, retryCount)));
          return fetchInitial(retryCount + 1);
        }
        setFetchError("Failed to load. Check your connection.");
      } finally {
        setLoading(false);
        isLoadingRef.current = false;
        if (jumpCursor) setJumpCursor(null);
      }
    },
    [apiEndpoint, buildQuery, jumpCursor, onPostsChanged],
  );

  const fetchMore = useCallback(async () => {
    if (isLoadingRef.current || !nextCursor) return;
    isLoadingRef.current = true;
    setLoadingMore(true);
    try {
      const params = buildQuery(nextCursor);
      const res = await fetch(`${apiEndpoint}?${params}`);
      const data = (await res.json()) as ListApiResponse<TPost>;
      setPosts((prev) => {
        const next = [...prev, ...(data.posts ?? [])];
        onPostsChanged?.(next);
        return next;
      });
      setNextCursor(data.nextCursor ?? null);
      setDone(data.nextCursor == null);
    } finally {
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [apiEndpoint, buildQuery, nextCursor, onPostsChanged]);

  const cacheKey = useMemo(
    () =>
      `${apiEndpoint}::${buildFilterParams({
        search,
        sort,
        aiTags,
        content,
        audio,
        link,
        multiMedia,
        tagged,
        share,
        quality,
        captionQuality,
        enriched,
        kind,
        subKind,
      }).toString()}${extraParams ? `::${JSON.stringify(extraParams)}` : ""}`,
    [
      apiEndpoint,
      search,
      sort,
      aiTags,
      content,
      audio,
      link,
      multiMedia,
      tagged,
      share,
      quality,
      captionQuality,
      enriched,
      kind,
      subKind,
      extraParams,
    ],
  );
  const initialisedKeyRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (initialisedKeyRef.current === cacheKey) return;
    initialisedKeyRef.current = cacheKey;
    const cached = listCache.get(cacheKey) as ListSnapshot<TPost> | undefined;
    if (cached && cached.posts.length > 0) {
      setPosts(cached.posts);
      setNextCursor(cached.nextCursor);
      setDone(cached.done);
      setTotal(cached.total);
      setFilteredTotal(cached.filteredTotal);
      setLoading(false);
      onPostsChanged?.(cached.posts);
      pendingScrollTargetRef.current = cached.scrollTop > 0 ? cached.scrollTop : null;
      if (pendingScrollTargetRef.current != null) {
        isRestoringRef.current = true;
      }
      return;
    }
    fetchInitial();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  useLayoutEffect(() => {
    if (pendingScrollTargetRef.current == null) return;
    const el = findScrollParent(rootRef.current);
    if (!el) return;
    const target = pendingScrollTargetRef.current;
    const start = performance.now();
    let cancelled = false;

    const apply = () => {
      if (cancelled || pendingScrollTargetRef.current == null) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) {
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

  useEffect(() => {
    const existing = listCache.get(cacheKey) as ListSnapshot<TPost> | undefined;
    listCache.set(cacheKey, {
      posts,
      nextCursor,
      done,
      total,
      filteredTotal,
      scrollTop: existing?.scrollTop ?? 0,
    });
  }, [cacheKey, posts, nextCursor, done, total, filteredTotal]);

  useEffect(() => {
    const el = findScrollParent(rootRef.current);
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      if (isRestoringRef.current) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const snap = listCache.get(cacheKey) as ListSnapshot<TPost> | undefined;
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

  // URL sync
  useEffect(() => {
    const params = buildFilterParams({
      search,
      sort,
      aiTags,
      content,
      audio,
      link,
      multiMedia,
      tagged,
      share,
      quality,
      captionQuality,
      enriched,
      kind,
    });
    const url = new URL(window.location.href);
    for (const key of [
      "search",
      "sort",
      "tags",
      "content",
      "audio",
      "link",
      "multiMedia",
      "tagged",
      "share",
      "quality",
      "captionQuality",
      "enriched",
      "kind",
    ]) {
      url.searchParams.delete(key);
    }
    params.forEach((v, k) => url.searchParams.set(k, v));
    window.history.replaceState(null, "", url.toString());
  }, [search, sort, aiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind]);

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

  const noun = itemNoun ?? { singular: "post", plural: "posts" };
  const countLabel =
    filteredTotal < total
      ? `${filteredTotal.toLocaleString()} of ${total.toLocaleString()} ${noun.plural}`
      : `${total.toLocaleString()} ${noun.plural}`;

  return (
    <div className="space-y-4 md:space-y-6" ref={rootRef}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 md:text-2xl">{title}</h1>
          <p className="text-sm text-gray-500">{countLabel}</p>
        </div>
        {headerActions && <div className="flex flex-wrap items-center gap-2">{headerActions}</div>}
      </div>

      {!hideKindTabs && (
        <>
          <KindTabs current={kind} counts={kindCounts} />
          <SubKindTabs kind={kind} current={subKind} counts={subKindCounts} totals={subKindTotals} />
        </>
      )}

      {beforeList}

      {/* Search + filter row */}
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
              placeholder={aiMode ? "AI search — describe what you're looking for..." : `Search ${noun.plural}...`}
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
            captionQuality={captionQuality}
            setCaptionQuality={setCaptionQuality}
            enriched={enriched}
            setEnriched={setEnriched}
            activeCount={activeFilterCount}
            onReset={resetFilters}
          />
        </div>

        {aiResult && (
          <div className="rounded-lg border border-purple-100 bg-purple-50 px-4 py-2 text-sm space-y-1">
            {aiResult.explanation && <p className="text-purple-700">{aiResult.explanation}</p>}
            {aiResult.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {aiResult.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {bulkBar}

      {loading && posts.length === 0 ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      ) : !loading && posts.length === 0 ? (
        emptyState ?? (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
            {fetchError ? (
              <>
                <p className="text-red-600">{fetchError}</p>
                <button
                  onClick={() => fetchInitial()}
                  className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                >
                  Retry
                </button>
              </>
            ) : (
              <p className="text-gray-500">No {noun.plural} found.</p>
            )}
          </div>
        )
      ) : (
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60">
              <Spinner className="h-6 w-6 text-gray-400" />
            </div>
          )}
          <div className="space-y-2">
            {showSelectAll && onSelectAllToggle && (
              <div className="flex items-center gap-3 px-2 pb-1">
                <input
                  type="checkbox"
                  checked={allSelected ?? false}
                  onChange={(e) => onSelectAllToggle(e.target.checked, posts)}
                  className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
                />
                <span className="text-xs text-gray-500">Select all</span>
              </div>
            )}
            {posts.map((post, index) => (
              <div key={getPostId(post)}>{renderRow(post, index)}</div>
            ))}
          </div>
        </div>
      )}

      {posts.length > 0 && loadingMore && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-200" />
          ))}
        </div>
      )}
      {posts.length > 0 && done && (
        <p className="py-6 text-center text-sm text-gray-400">
          End of list — {posts.length} of {filteredTotal.toLocaleString()} {noun.plural}
        </p>
      )}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </div>
  );
}
