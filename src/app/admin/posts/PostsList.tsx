"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
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
  SlidersHorizontal,
  Send,
} from "lucide-react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { ViewToggle } from "./ViewToggle";
import { KindTabs } from "./KindTabs";
import { PlatformIcons } from "../scheduled/PlatformIcons";
import { displayBody } from "@/lib/post-body";
import {
  CONTENT_CATEGORIES,
  AUDIO_CATEGORIES,
  type ContentCategory,
  type AudioCategory,
} from "@/lib/posts-query";

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
  media: { id: string; mimeType: string; hasAudio: boolean | null }[];
  publishes: { platform: string; status: string }[];
}

type LinkFilter = "all" | "with" | "without";
type MultiMediaFilter = "all" | "2";
type TaggedFilter = "all" | "yes" | "no";
type KindFilter = "posts" | "stories";

const CONTENT_OPTIONS: { value: ContentCategory; label: string }[] = [
  { value: "caption", label: "Caption only" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "nocaption", label: "No caption" },
];

const AUDIO_OPTIONS: { value: AudioCategory; label: string }[] = [
  { value: "audible", label: "Video with audio" },
  { value: "silent", label: "Silent video" },
  { value: "nonvideo", label: "Non-video posts" },
];

const SORT_OPTIONS = [
  { value: "originalDate_desc", label: "Post date (newest)" },
  { value: "originalDate_asc", label: "Post date (oldest)" },
  { value: "createdAt_desc", label: "Import date (newest)" },
  { value: "createdAt_asc", label: "Import date (oldest)" },
];

function parseCsvToSet<T extends string>(
  raw: string | undefined,
  allowed: readonly T[]
): Set<T> {
  if (raw == null) return new Set(allowed);
  const out = new Set<T>();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if ((allowed as readonly string[]).includes(v)) out.add(v as T);
  }
  return out;
}

function serializeSet<T extends string>(
  set: Set<T>,
  allowed: readonly T[]
): string | null {
  if (allowed.every((v) => set.has(v))) return null;
  return [...set].join(",");
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

interface FilterMenuProps {
  sort: string;
  setSort: (s: string) => void;
  content: Set<ContentCategory>;
  setContent: (s: Set<ContentCategory>) => void;
  audio: Set<AudioCategory>;
  setAudio: (s: Set<AudioCategory>) => void;
  link: LinkFilter;
  setLink: (v: LinkFilter) => void;
  multiMedia: MultiMediaFilter;
  setMultiMedia: (v: MultiMediaFilter) => void;
  tagged: TaggedFilter;
  setTagged: (v: TaggedFilter) => void;
  activeCount: number;
  onReset: () => void;
}

function FilterMenu(props: FilterMenuProps) {
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

  function toggleContent(v: ContentCategory) {
    const next = new Set(props.content);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    props.setContent(next);
  }
  function toggleAudio(v: AudioCategory) {
    const next = new Set(props.audio);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    props.setAudio(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:border-blue-500 focus:outline-none"
      >
        <SlidersHorizontal className="h-4 w-4" />
        Filters
        {props.activeCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">
            {props.activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg">
          <div className="flex items-center justify-between pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Filters
            </span>
            {props.activeCount > 0 && (
              <button
                onClick={props.onReset}
                className="text-xs text-blue-600 hover:underline"
              >
                Reset
              </button>
            )}
          </div>
          <div className="max-h-96 space-y-4 overflow-y-auto pr-1">
            <FilterSection title="Sort">
              {SORT_OPTIONS.map((o) => (
                <RadioRow
                  key={o.value}
                  name="sort"
                  checked={props.sort === o.value}
                  onChange={() => props.setSort(o.value)}
                  label={o.label}
                />
              ))}
            </FilterSection>
            <FilterSection title="Content">
              {CONTENT_OPTIONS.map((o) => (
                <CheckRow
                  key={o.value}
                  checked={props.content.has(o.value)}
                  onChange={() => toggleContent(o.value)}
                  onOnly={() => props.setContent(new Set([o.value]))}
                  label={o.label}
                />
              ))}
            </FilterSection>
            <FilterSection title="Audio">
              {AUDIO_OPTIONS.map((o) => (
                <CheckRow
                  key={o.value}
                  checked={props.audio.has(o.value)}
                  onChange={() => toggleAudio(o.value)}
                  onOnly={() => props.setAudio(new Set([o.value]))}
                  label={o.label}
                />
              ))}
            </FilterSection>
            <FilterSection title="Facebook link">
              <RadioRow
                name="link"
                checked={props.link === "all"}
                onChange={() => props.setLink("all")}
                label="Any"
              />
              <RadioRow
                name="link"
                checked={props.link === "with"}
                onChange={() => props.setLink("with")}
                label="Has FB link"
              />
              <RadioRow
                name="link"
                checked={props.link === "without"}
                onChange={() => props.setLink("without")}
                label="No FB link"
              />
            </FilterSection>
            <FilterSection title="Media count">
              <RadioRow
                name="multi"
                checked={props.multiMedia === "all"}
                onChange={() => props.setMultiMedia("all")}
                label="Any"
              />
              <RadioRow
                name="multi"
                checked={props.multiMedia === "2"}
                onChange={() => props.setMultiMedia("2")}
                label="2 or more media"
              />
            </FilterSection>
            <FilterSection title="AI tags">
              <RadioRow
                name="tagged"
                checked={props.tagged === "all"}
                onChange={() => props.setTagged("all")}
                label="Any"
              />
              <RadioRow
                name="tagged"
                checked={props.tagged === "yes"}
                onChange={() => props.setTagged("yes")}
                label="AI tagged"
              />
              <RadioRow
                name="tagged"
                checked={props.tagged === "no"}
                onChange={() => props.setTagged("no")}
                label="Not yet tagged"
              />
            </FilterSection>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function RadioRow({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer border-gray-300 text-blue-600"
      />
      {label}
    </label>
  );
}

function CheckRow({
  checked,
  onChange,
  onOnly,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  onOnly?: () => void;
  label: string;
}) {
  return (
    <label className="group flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-gray-700 hover:bg-gray-50">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
      />
      <span className="flex-1">{label}</span>
      {onOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOnly();
          }}
          className="ml-auto hidden rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600 hover:bg-blue-50 group-hover:inline"
        >
          Only
        </button>
      )}
    </label>
  );
}

interface PostsListProps {
  initialSearch?: string;
  initialSort?: string;
  initialContent?: string;
  initialAudio?: string;
  initialLink?: LinkFilter;
  initialMultiMedia?: MultiMediaFilter;
  initialTagged?: TaggedFilter;
  initialTags?: string[];
  initialKind?: KindFilter;
}

export function PostsList({
  initialSearch = "",
  initialSort = "originalDate_desc",
  initialContent,
  initialAudio,
  initialLink = "all",
  initialMultiMedia = "all",
  initialTagged = "all",
  initialTags = [],
  initialKind = "posts",
}: PostsListProps) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [kindCounts, setKindCounts] = useState<{ posts: number; stories: number } | null>(null);
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
  const [link, setLink] = useState<LinkFilter>(initialLink);
  const [multiMedia, setMultiMedia] = useState<MultiMediaFilter>(initialMultiMedia);
  const [tagged, setTagged] = useState<TaggedFilter>(initialTagged);
  const searchParams = useSearchParams();
  const kindQS = searchParams.get("kind");
  const kind: KindFilter =
    kindQS === "stories" ? "stories" : "posts";
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
  const lastSelectedIndexRef = useRef<number | null>(null);
  const isLoadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

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

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (sort !== "originalDate_desc") n++;
    if (content.size !== CONTENT_CATEGORIES.length) n++;
    if (audio.size !== AUDIO_CATEGORIES.length) n++;
    if (link !== "all") n++;
    if (multiMedia !== "all") n++;
    if (tagged !== "all") n++;
    return n;
  }, [sort, content, audio, link, multiMedia, tagged]);

  function resetFilters() {
    setSort("originalDate_desc");
    setContent(new Set(CONTENT_CATEGORIES));
    setAudio(new Set(AUDIO_CATEGORIES));
    setLink("all");
    setMultiMedia("all");
    setTagged("all");
  }

  const buildQuery = useCallback(
    (cursor: string | null) => {
      const contentParam = serializeSet(content, CONTENT_CATEGORIES);
      const audioParam = serializeSet(audio, AUDIO_CATEGORIES);
      const params = new URLSearchParams({
        limit: "20",
        sort,
        ...(search ? { search } : {}),
        ...(aiTags.length > 0 ? { tags: aiTags.join(",") } : {}),
        ...(contentParam ? { content: contentParam } : {}),
        ...(audioParam ? { audio: audioParam } : {}),
        ...(link !== "all" ? { link } : {}),
        ...(multiMedia !== "all" ? { multiMedia } : {}),
        ...(tagged !== "all" ? { tagged } : {}),
        kind,
      });
      if (cursor) params.set("cursor", cursor);
      return params;
    },
    [search, sort, aiTags, content, audio, link, multiMedia, tagged, kind],
  );

  const fetchInitial = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    try {
      const params = buildQuery(null);
      const res = await fetch(`/api/posts?${params}`);
      const data = await res.json();
      setPosts(data.posts ?? []);
      setTotal(data.total ?? 0);
      if (data.kindCounts) setKindCounts(data.kindCounts);
      setNextCursor(data.nextCursor ?? null);
      setDone(data.nextCursor == null);
      setSelectedIds(new Set());
      setSelectAllMode(false);
      lastSelectedIndexRef.current = null;
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [buildQuery]);

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

  useEffect(() => {
    fetchInitial();
  }, [fetchInitial]);

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
    const qs = new URLSearchParams();
    if (search) qs.set("search", search);
    if (sort && sort !== "originalDate_desc") qs.set("sort", sort);
    const contentParam = serializeSet(content, CONTENT_CATEGORIES);
    if (contentParam) qs.set("content", contentParam);
    const audioParam = serializeSet(audio, AUDIO_CATEGORIES);
    if (audioParam) qs.set("audio", audioParam);
    if (link !== "all") qs.set("link", link);
    if (multiMedia !== "all") qs.set("multiMedia", multiMedia);
    if (tagged !== "all") qs.set("tagged", tagged);
    if (aiTags.length > 0) qs.set("tags", aiTags.join(","));
    if (kind !== "posts") qs.set("kind", kind);
    return qs.toString();
  }, [search, sort, content, audio, link, multiMedia, tagged, aiTags, kind]);

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
    const count = selectAllMode ? total : selectedIds.size;
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
  }, [bulkDelete, selectAllMode, total, selectedIds, search, fetchInitial]);

  const { confirming: bulkConfirming, trigger: triggerBulkDelete } = useConfirm(handleBulkDelete);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {kind === "stories" ? "All Stories" : "All Posts"}
          </h1>
          <p className="text-sm text-gray-500">
            {total} {kind === "stories" ? "stories" : "posts"} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewToggle />
          <Link href="/admin/trash">
            <Button size="sm" variant="outline">
              <Trash2 className="h-4 w-4" />
              Trash
            </Button>
          </Link>
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
          <Link href="/admin/posts/new">
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

      <KindTabs current={kind} counts={kindCounts} />

      {/* Combined search + filters */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
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
          <FilterMenu
            sort={sort}
            setSort={setSort}
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
              onClick={() => { setSelectedIds(new Set()); setSelectAllMode(false); lastSelectedIndexRef.current = null; }}
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
                className={`flex items-center gap-3 rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm ${
                  isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200"
                }`}
              >
                {/* Checkbox */}
                <div className="flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onClick={(e) => handleCheckboxClick(e, post.id, index)}
                    onChange={() => {}}
                    className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
                  />
                </div>

                <Link href={postHref(post.id)} className="flex min-w-0 flex-1 items-center gap-4">
                  {/* Thumbnail */}
                  <div
                    className="relative h-28 w-28 flex-shrink-0 overflow-hidden rounded-md bg-gray-100"
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
                    <div className="flex items-center gap-2">
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
                        {format(new Date(post.originalDate), "MMM d, yyyy · h:mm a")}
                      </span>
                      {(() => {
                        const typeLabel = post.postType && post.postType !== "POST" ? ` ${post.postType}` : "";
                        const label = `${post.source}${typeLabel}`;
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
                    {(() => { const visibleTags = post.tags; return visibleTags.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {visibleTags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {tag}
                          </span>
                        ))}
                        {visibleTags.length > 5 && (
                          <span className="text-xs text-gray-400">+{visibleTags.length - 5} more</span>
                        )}
                      </div>
                    ) : null; })()}
                  </div>

                  {/* Published platforms */}
                  <PlatformIcons
                    platforms={[
                      ...new Set(
                        post.publishes
                          .filter((p) => p.status === "PUBLISHED")
                          .map((p) => p.platform),
                      ),
                    ]}
                    size={16}
                    className="flex-shrink-0 gap-1.5"
                  />
                </Link>

                {/* Row actions */}
                <RowPublishAllButton post={post} />
                <RowDeleteButton
                  postId={post.id}
                  onDeleted={() => {
                    setPosts((prev) => prev.filter((p) => p.id !== post.id));
                    setTotal((t) => Math.max(0, t - 1));
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
          End of list — {posts.length} of {total} posts
        </p>
      )}
      <div ref={sentinelRef} className="h-px" aria-hidden="true" />
    </div>
  );
}
