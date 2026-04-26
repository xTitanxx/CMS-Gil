"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Plus,
  Image as ImageIcon,
  Pencil,
  VolumeX,
  Search,
  Sparkles,
  X,
  RefreshCw,
} from "lucide-react";
import { ViewToggle } from "./ViewToggle";
import { KindTabs, type PostKind } from "./KindTabs";
import { SubKindTabs, type SubKindCounts } from "./SubKindTabs";
import { displayBody } from "@/lib/post-body";
import { Link as LinkIcon } from "lucide-react";
import { LazyVideo } from "@/components/LazyVideo";
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

interface FeedPost {
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
}

interface FeedState {
  posts: FeedPost[];
  nextCursor: string | null;
  scrollY: number;
  done: boolean;
}

const feedCache = new Map<string, FeedState>();

// Base64url-encode a cursor client-side to match the server's encodeCursor().
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

export function PostsFeed() {
  const searchParams = useSearchParams();
  const kind: PostKind =
    searchParams.get("kind") === "stories" ? "stories" : "posts";
  const subKindQS = searchParams.get("subKind");
  const subKind = ["all", "video-audio", "video-silent", "photo", "text", "quoted"].includes(subKindQS ?? "")
    ? (subKindQS as string)
    : "all";
  const [subKindCounts, setSubKindCounts] = useState<SubKindCounts | null>(null);
  const [subKindTotals, setSubKindTotals] = useState<SubKindCounts | null>(null);

  // --- filter state, initialised from URL ---
  const [search, setSearch] = useState(() => searchParams.get("search") ?? "");
  const [sort, setSort] = useState(() => searchParams.get("sort") ?? "originalDate_desc");
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
  const [captionQuality] = useState<Set<CaptionQualityValue>>(() =>
    new Set(CAPTION_QUALITY_VALUES),
  );
  const [enriched, setEnriched] = useState<Set<EnrichedValue>>(() =>
    parseCsvToSet(searchParams.get("enriched") ?? undefined, ENRICHED_VALUES),
  );
  const [aiTags] = useState<string[]>(() => {
    const t = searchParams.get("tags");
    return t ? t.split(",").filter(Boolean) : [];
  });
  const [jumpCursor, setJumpCursor] = useState<string | null>(null);

  // AI search
  const [aiMode, setAiMode] = useState(false);
  const [aiQuery, setAiQuery] = useState("");
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState<{ tags: string[]; keywords: string[]; explanation: string } | null>(null);
  const [localAiTags, setLocalAiTags] = useState<string[]>(aiTags);

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
    setLocalAiTags(data.tags ?? []);
    if (data.keywords?.[0]) setSearch(data.keywords[0]);
    setAiSearching(false);
  }

  function clearAiSearch() {
    setAiQuery("");
    setAiResult(null);
    setLocalAiTags([]);
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
    () => countActiveFilters({ sort, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched }),
    [sort, content, audio, link, multiMedia, tagged, share, quality, enriched],
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
    setEnriched(new Set(ENRICHED_VALUES));
  }

  // --- cache key based on all filters ---
  const cacheKey = useMemo(() => {
    return buildFilterParams({
      search, sort, aiTags: localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind,
    }).toString();
  }, [search, sort, localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind]);

  const [posts, setPosts] = useState<FeedPost[]>(
    () => feedCache.get(cacheKey)?.posts ?? [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(
    () => feedCache.get(cacheKey)?.nextCursor ?? null,
  );
  const [done, setDone] = useState<boolean>(
    () => feedCache.get(cacheKey)?.done ?? false,
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const initialisedKeyRef = useRef<string | null>(null);

  const detailQueryString = useMemo(() => {
    const qs = buildFilterParams({
      search, sort, aiTags: localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind,
    });
    qs.set("view", "feed");
    return qs.toString();
  }, [search, sort, localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind]);

  const fetchPage = useCallback(
    async (cursor: string | null) => {
      if (isLoadingRef.current) return;
      isLoadingRef.current = true;
      setLoading(true);
      setErrorMessage(null);
      try {
        const qs = buildFilterParams({
          search, sort, aiTags: localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind,
        });
        qs.set("limit", "20");
        if (sort === "originalDate_desc") qs.delete("sort");
        qs.set("sort", sort);
        if (cursor) qs.set("cursor", cursor);
        const res = await fetch(`/api/posts?${qs.toString()}`);
        if (!res.ok) throw new Error(`Request failed: ${res.status}`);
        const data = (await res.json()) as {
          posts: FeedPost[];
          nextCursor: string | null;
          subKindCounts?: SubKindCounts;
          subKindTotals?: SubKindCounts;
        };
        setPosts((prev) => (cursor ? [...prev, ...data.posts] : data.posts));
        setNextCursor(data.nextCursor);
        setDone(data.nextCursor === null);
        if (data.subKindCounts) setSubKindCounts(data.subKindCounts);
        setSubKindTotals(data.subKindTotals ?? null);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load feed");
      } finally {
        setLoading(false);
        isLoadingRef.current = false;
      }
    },
    [search, sort, localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind],
  );

  // Fetch on filter change or initial mount
  useEffect(() => {
    if (initialisedKeyRef.current === cacheKey) return;
    initialisedKeyRef.current = cacheKey;

    const cached = feedCache.get(cacheKey);
    if (cached && cached.posts.length > 0) {
      setPosts(cached.posts);
      setNextCursor(cached.nextCursor);
      setDone(cached.done);
      if (cached.scrollY) {
        requestAnimationFrame(() => window.scrollTo(0, cached.scrollY));
      }
      return;
    }
    fetchPage(jumpCursor);
    if (jumpCursor) setJumpCursor(null);
  }, [cacheKey, fetchPage, jumpCursor]);

  useEffect(() => {
    feedCache.set(cacheKey, {
      posts,
      nextCursor,
      scrollY: 0,
      done,
    });
  }, [cacheKey, posts, nextCursor, done]);

  useEffect(() => {
    const saveScroll = () => {
      const existing = feedCache.get(cacheKey);
      if (existing) {
        feedCache.set(cacheKey, { ...existing, scrollY: window.scrollY });
      }
    };
    window.addEventListener("pagehide", saveScroll);
    return () => {
      saveScroll();
      window.removeEventListener("pagehide", saveScroll);
    };
  }, [cacheKey]);

  // Sync filter state back to URL
  useEffect(() => {
    const params = buildFilterParams({
      search, sort, aiTags: localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind,
    });
    params.set("view", "feed");
    const url = new URL(window.location.href);
    for (const key of [
      "search", "sort", "tags", "content", "audio", "link",
      "multiMedia", "tagged", "share", "quality", "enriched", "kind", "subKind", "view",
    ]) {
      url.searchParams.delete(key);
    }
    params.forEach((v, k) => url.searchParams.set(k, v));
    window.history.replaceState(null, "", url.toString());
  }, [search, sort, localAiTags, content, audio, link, multiMedia, tagged, share, quality, captionQuality, enriched, kind, subKind]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    let root: Element | null = el.parentElement;
    while (root && root !== document.body) {
      const style = getComputedStyle(root);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      root = root.parentElement;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && nextCursor && !isLoadingRef.current) {
            fetchPage(nextCursor);
          }
        }
      },
      { root: root && root !== document.body ? root : null, rootMargin: "400px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextCursor, fetchPage]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="hidden text-2xl font-bold text-gray-900 md:block">
            {kind === "stories" ? "All Stories" : "All Posts"}
          </h1>
          <p className="text-sm text-gray-500">
            {posts.length > 0 ? `Showing ${posts.length}` : "Feed view"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Link href="/admin/posts/new">
            <Button size="sm">
              <Plus className="h-4 w-4" />
              New Post
            </Button>
          </Link>
        </div>
      </div>

      <KindTabs current={kind} />
      <SubKindTabs kind={kind} current={subKind} counts={subKindCounts} totals={subKindTotals} />

      {/* Search + filters toolbar */}
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
                  setLocalAiTags([]);
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
              if (c) {
                setJumpCursor(c);
                // Reset cache key so the effect re-fires
                initialisedKeyRef.current = null;
              }
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
            setCaptionQuality={() => {}}
            enriched={enriched}
            setEnriched={setEnriched}
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

      <div className="mx-auto w-full max-w-xl space-y-3">
        {posts.map((post) => (
          <FeedCard
            key={post.id}
            post={post}
            href={`/admin/posts/${post.id}?${detailQueryString}`}
          />
        ))}

        {loading && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-8 w-8 animate-pulse rounded-full bg-gray-200" />
              <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
            </div>
            <div className="h-4 w-4/5 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-4 w-3/5 animate-pulse rounded bg-gray-200" />
            <div className="mt-4 h-52 animate-pulse rounded-xl bg-gray-200" />
          </div>
        )}

        {errorMessage && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}{" "}
            <button
              className="font-medium underline hover:text-red-900"
              onClick={() => fetchPage(nextCursor)}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && posts.length === 0 && !errorMessage && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 py-16 text-center">
            <p className="text-gray-500">No posts found.</p>
            <Link
              href="/admin/import"
              className="mt-2 block text-sm text-blue-600 hover:underline"
            >
              Import posts
            </Link>
          </div>
        )}

        {done && posts.length > 0 && (
          <p className="py-6 text-center text-sm text-gray-400">
            End of feed — {posts.length} posts
          </p>
        )}

        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
      </div>
    </div>
  );
}

function FeedCard({ post, href }: { post: FeedPost; href: string }) {
  const firstMedia = post.media[0];
  const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;

  const typeLabel =
    post.postType && post.postType !== "POST"
      ? post.postType.charAt(0) + post.postType.slice(1).toLowerCase()
      : "Post";

  const body = displayBody(post.body) ?? "";
  const [expanded, setExpanded] = useState(false);
  const CAPTION_CHAR_LIMIT = 220;
  const isLong = body.length > CAPTION_CHAR_LIMIT;
  const shownBody =
    !expanded && isLong
      ? body.slice(0, CAPTION_CHAR_LIMIT).trimEnd() + "…"
      : body;

  return (
    <article className="overflow-hidden rounded-lg bg-white shadow-sm">
      {/* Header — compact, FB-style */}
      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold text-gray-900">Gil Alter</span>
            {post.platformUrl ? (
              <a
                href={post.platformUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                title="Open original on Facebook"
              >
                {typeLabel}
              </a>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                {typeLabel}
              </Badge>
            )}
            {post.share && (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                title={
                  post.share.url
                    ? `Quoted post: ${post.share.url}`
                    : "Quoted a Facebook post (share card not preserved by export)"
                }
              >
                <LinkIcon className="h-3 w-3" />
                {post.share.url ? "Shared link" : "Quoted FB post"}
              </span>
            )}
            {post.isSilent && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600"
                title="Silent video"
              >
                <VolumeX className="h-3 w-3" /> Silent
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500">
            {format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-full p-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          title="Edit post"
        >
          <Pencil className="h-4 w-4" />
        </Link>
      </div>

      {/* Caption — public-feed styling + See more */}
      {body && (
        <div className="px-3 pb-2">
          <p className="whitespace-pre-wrap text-[15px] leading-[1.35] text-gray-900">
            {shownBody}
            {isLong && !expanded && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="font-semibold text-gray-600 hover:underline"
                >
                  See more
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {/* Media — edge to edge */}
      {isVideo && post.videoUrl ? (
        <LazyVideo
          src={post.videoUrl}
          poster={post.thumbUrl}
          wrapperClassName="relative w-full bg-black"
          className="w-full object-contain max-h-[75vh]"
          controls
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
        />
      ) : post.thumbUrl ? (
        <Link href={href} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.thumbUrl}
            alt=""
            className="h-auto w-full"
          />
        </Link>
      ) : !body ? (
        <div className="flex items-center justify-center px-5 py-10 text-gray-300">
          <ImageIcon className="h-8 w-8" />
        </div>
      ) : null}

      {/* Publish status chips */}
      {post.publishes.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-gray-100 px-3 py-2">
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
              className="text-[10px]"
            >
              {p.platform}
            </Badge>
          ))}
        </div>
      )}
    </article>
  );
}
