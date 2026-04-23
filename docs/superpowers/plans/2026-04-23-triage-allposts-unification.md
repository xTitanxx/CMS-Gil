# Triage + All Posts Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the chrome of `/admin/triage` and `/admin/posts` into a single `PostListShell` component so both pages share search, sort, jump-to-date, filters menu, kind/subKind tabs, URL-state, counts, infinite-scroll, and scroll restoration — while each keeps its own row renderer (triage card vs. compact row) and page-specific controls.

**Architecture:** Headless shell at `src/app/admin/_shared/PostListShell.tsx` owns chrome + list state. Two consumers — `AllPostsView` (compact rows + bulk-select + header actions) and `TriageView` (triage card + bucket pills + `readiness=NOT_READY` preset). Backend: `/api/triage` delegates to the same `buildPostsQuery` helper as `/api/posts` so filters share one Prisma-where builder.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, TypeScript, Tailwind, vitest.

**Branch:** work on a fresh branch `feature/triage-allposts-unify` (rebased from `claude/personal-cms-social-posting-QV57t`). Final PR against the main branch.

---

## File Structure

### New files
| Path | Responsibility |
|---|---|
| `src/app/admin/_shared/PostListShell.tsx` | Headless shell: title, tabs, search bar, sort/date/filter menus, URL sync, infinite scroll, cache, scroll restore, loading/empty states. |
| `src/app/admin/_shared/PostListShell.types.ts` | Shared prop types, `SharedFilterState`, `RenderRowFn`. |
| `src/app/admin/_shared/useListState.ts` | Fetch + cache + scroll-restore hook extracted from `PostsList`. |
| `src/app/admin/posts/AllPostsView.tsx` | Wraps `PostListShell` + `PostRow` + bulk bar + header actions (Trash, AI Tag All, Rate Captions, New Post). |
| `src/app/admin/posts/PostRow.tsx` | Single compact row renderer extracted from `PostsList.tsx` lines ~1096-1340. |
| `src/app/admin/triage/TriageView.tsx` | Wraps `PostListShell` + `TriageCard` + `TriageBuckets` + readiness preset. |
| `src/app/admin/triage/TriageBuckets.tsx` | Bucket-pill strip extracted from `TriageFeed`. |

### Modified files
| Path | Change |
|---|---|
| `src/app/admin/posts/page.tsx` | Render `AllPostsView` instead of `PostsList`. |
| `src/app/admin/triage/page.tsx` | Render `TriageView` instead of `TriageFeed`. |
| `src/app/admin/triage/TriageTabs.tsx` | Label `Readiness` → `Needs fixes`; `Post improvements` → `AI suggestions`. Slug `readiness`→`needs-fixes`, `improvements`→`ai-suggestions`. |
| `src/app/admin/triage/improvements/ImprovementsFeed.tsx` | Wrap list body in shell chrome (title + search/sort/jump-to-date). |
| `src/app/admin/triage/improvements/page.tsx` | Update tab-slug reference. |
| `src/app/api/triage/route.ts` | Delegate to `buildPostsQuery` + align response shape with `/api/posts`. |
| `src/app/api/triage/count/route.ts` | Accept `kind`, `subKind`, `type` query params so counts reflect the current slice. |
| `src/lib/posts-query.ts` | No structural change; add documented `readiness` / `notReadyReasons` merge hook via optional `opts.extraWhere` so `/api/triage` can inject `readiness=NOT_READY` without forking the function. |

### Deleted files (last task only)
- `src/app/admin/posts/PostsList.tsx`
- `src/app/admin/triage/TriageFeed.tsx`

---

## Task 1: Branch + tab renames

**Files:**
- Create branch `feature/triage-allposts-unify`
- Modify: `src/app/admin/triage/TriageTabs.tsx`
- Modify: `src/app/admin/triage/page.tsx` (ref update only)
- Modify: `src/app/admin/triage/improvements/page.tsx` (ref update only)

- [ ] **Step 1: Create branch off main**

```bash
git checkout claude/personal-cms-social-posting-QV57t
git pull --ff-only
git checkout -b feature/triage-allposts-unify
```

- [ ] **Step 2: Update `TriageTabs.tsx` — rename labels + slugs**

Replace the file contents of `src/app/admin/triage/TriageTabs.tsx` with:

```tsx
"use client";
import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";

const TABS = [
  { slug: "needs-fixes", label: "Needs fixes", href: "/admin/triage", icon: AlertCircle },
  { slug: "ai-suggestions", label: "AI suggestions", href: "/admin/triage/improvements", icon: Sparkles },
] as const;

export function TriageTabs({ active }: { active: "needs-fixes" | "ai-suggestions" }) {
  return (
    <div className="mb-4 flex gap-2 border-b border-gray-200">
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.slug === active;
        return (
          <Link
            key={t.slug}
            href={t.href}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-gray-500 hover:text-gray-800"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Update triage page slug**

In `src/app/admin/triage/page.tsx`, change:

```tsx
<TriageTabs active="readiness" />
```

to:

```tsx
<TriageTabs active="needs-fixes" />
```

- [ ] **Step 4: Update improvements page slug**

In `src/app/admin/triage/improvements/page.tsx`, change:

```tsx
<TriageTabs active="improvements" />
```

to:

```tsx
<TriageTabs active="ai-suggestions" />
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/triage/TriageTabs.tsx src/app/admin/triage/page.tsx src/app/admin/triage/improvements/page.tsx
git commit -m "refactor(triage): rename tabs to Needs fixes / AI suggestions

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Add optional `extraWhere` hook to `buildPostsQuery`

**Why:** Triage needs to pin `readiness=NOT_READY` + optional `notReadyReasons: { has: bucket }` on top of the full shared filter set. Passing these as an opt argument keeps the filter builder as the single source of truth.

**Files:**
- Modify: `src/lib/posts-query.ts`
- Modify: `src/lib/posts-query.test.ts`

- [ ] **Step 1: Write failing test**

Append to `src/lib/posts-query.test.ts`:

```ts
describe("buildPostsQuery extraWhere option", () => {
  it("AND-merges extraWhere clauses into the resulting where", () => {
    const { where } = buildPostsQuery(
      { kind: "posts" },
      "user-1",
      {
        extraWhere: [
          { readiness: "NOT_READY" },
          { notReadyReasons: { has: "silent-video" } },
        ],
      },
    );
    const ands = (where.AND ?? []) as Array<Record<string, unknown>>;
    expect(ands).toEqual(
      expect.arrayContaining([
        { readiness: "NOT_READY" },
        { notReadyReasons: { has: "silent-video" } },
      ]),
    );
  });

  it("ignores missing/empty extraWhere", () => {
    const { where } = buildPostsQuery({ kind: "posts" }, "user-1");
    expect(where.userId).toBe("user-1");
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm test -- posts-query`
Expected: both new tests FAIL — `extraWhere` option not defined.

- [ ] **Step 3: Implement `extraWhere` option**

In `src/lib/posts-query.ts`, update the signature of `buildPostsQuery` (around line 216):

Change the `opts` parameter type from:

```ts
opts?: { postIdAllowlist?: string[] | null },
```

to:

```ts
opts?: {
  postIdAllowlist?: string[] | null;
  /** Extra Prisma PostWhereInput clauses to AND into the final where. */
  extraWhere?: Prisma.PostWhereInput[];
},
```

Then, just before the `const where: Prisma.PostWhereInput = {` assignment (around line 393), add:

```ts
if (opts?.extraWhere && opts.extraWhere.length > 0) {
  extraAnds.push(...opts.extraWhere);
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npm test -- posts-query`
Expected: all tests PASS.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/posts-query.ts src/lib/posts-query.test.ts
git commit -m "feat(posts-query): add extraWhere option for triage overlay

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rewrite `/api/triage` to use `buildPostsQuery` + aligned response shape

**Why:** Triage API must accept every shared filter param and return the same shape as `/api/posts` so `PostListShell` can use one fetch path.

**Files:**
- Modify: `src/app/api/triage/route.ts`

- [ ] **Step 1: Replace route file contents**

Replace the entire contents of `src/app/api/triage/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThumbnailUrl, getSignedDownloadUrl, getMediaUrl } from "@/lib/storage";
import {
  buildCursorClause,
  buildPostsQuery,
  cursorFromRow,
  decodeCursor,
  encodeCursor,
  parsePostsFilters,
} from "@/lib/posts-query";
import type { Prisma } from "@prisma/client";

const POST_INCLUDE = {
  media: {
    include: { audioTrack: true },
  },
  publishes: {
    select: {
      platform: true,
      status: true,
      platformUrl: true,
      scheduledAt: true,
    },
  },
  rating: true,
  analytics: {
    select: { platform: true, reactions: true, comments: true, shares: true },
  },
} as const;

type PostWithIncludes = Awaited<
  ReturnType<typeof prisma.post.findMany<{ include: typeof POST_INCLUDE }>>
>[number];

async function decoratePosts(posts: PostWithIncludes[]) {
  return Promise.all(
    posts.map(async (post) => {
      const firstMedia = post.media[0];
      const thumbUrl = firstMedia
        ? await getThumbnailUrl(firstMedia.storageKey, firstMedia.mimeType).catch(() => null)
        : null;
      const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;
      const videoMedia = post.media.filter((m) => m.mimeType.startsWith("video/"));
      const isSilent =
        videoMedia.length > 0 && videoMedia.every((m) => m.hasAudio === false);
      const videoUrl = isVideo && firstMedia
        ? await getSignedDownloadUrl(
            firstMedia.storageKey,
            undefined,
            firstMedia.mimeType,
          ).catch(() => null)
        : null;
      const mediaWithUrls = await Promise.all(
        post.media.map(async (m) => ({
          ...m,
          url: await getMediaUrl(m).catch(() => null),
          thumbnailUrl: await getThumbnailUrl(m.storageKey, m.mimeType).catch(() => null),
        })),
      );
      return { ...post, media: mediaWithUrls, thumbUrl, videoUrl, isVideo, isSilent };
    }),
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? "20");
    const cursorParam = searchParams.get("cursor");
    const cursor = decodeCursor(cursorParam);
    const bucket = searchParams.get("bucket");

    const filters = parsePostsFilters(searchParams);

    const readinessExtras: Prisma.PostWhereInput[] = [
      { readiness: "NOT_READY" },
    ];
    if (bucket) {
      readinessExtras.push({ notReadyReasons: { has: bucket } });
    }

    const { where: baseWhere, orderBy } = buildPostsQuery(
      filters,
      userId,
      { extraWhere: readinessExtras },
    );

    if (cursor) {
      const cursorClause = buildCursorClause(filters.sort, cursor);
      const where = { AND: [baseWhere, cursorClause] };
      const rows = await prisma.post.findMany({
        where,
        orderBy,
        take: limit,
        include: POST_INCLUDE,
      });
      const decorated = await decoratePosts(rows);
      const nextCursor =
        rows.length === limit
          ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
          : null;
      return NextResponse.json({ posts: decorated, nextCursor });
    }

    // Sub-kind counts, same spec as /api/posts
    const subKindSpecs: Array<{ key: string; kind: "posts" | "stories"; sub: string }> = [
      { key: "postsAll", kind: "posts", sub: "all" },
      { key: "postsVideoAudio", kind: "posts", sub: "video-audio" },
      { key: "postsVideoSilent", kind: "posts", sub: "video-silent" },
      { key: "postsPhoto", kind: "posts", sub: "photo" },
      { key: "postsText", kind: "posts", sub: "text" },
      { key: "postsQuoted", kind: "posts", sub: "quoted" },
      { key: "storiesAll", kind: "stories", sub: "all" },
      { key: "storiesVideoAudio", kind: "stories", sub: "video-audio" },
      { key: "storiesVideoSilent", kind: "stories", sub: "video-silent" },
    ];

    const { where: kindOnlyWhere } = buildPostsQuery(
      { ...filters, subKind: undefined },
      userId,
      { extraWhere: readinessExtras },
    );

    const [total, filteredTotal, rows, ...subCounts] = await Promise.all([
      prisma.post.count({ where: kindOnlyWhere }),
      prisma.post.count({ where: baseWhere }),
      prisma.post.findMany({
        where: baseWhere,
        orderBy,
        take: limit,
        include: POST_INCLUDE,
      }),
      ...subKindSpecs.map((spec) => {
        const { where } = buildPostsQuery(
          { ...filters, kind: spec.kind, subKind: spec.sub },
          userId,
          { extraWhere: readinessExtras },
        );
        return prisma.post.count({ where });
      }),
    ]);

    const subKindCounts = Object.fromEntries(
      subKindSpecs.map((spec, i) => [spec.key, subCounts[i] ?? 0]),
    ) as Record<string, number>;
    const postsCount = subKindCounts.postsAll ?? 0;
    const storiesCount = subKindCounts.storiesAll ?? 0;

    const decorated = await decoratePosts(rows);
    const nextCursor =
      rows.length === limit
        ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
        : null;

    return NextResponse.json({
      posts: decorated,
      total,
      filteredTotal,
      nextCursor,
      kindCounts: { posts: postsCount, stories: storiesCount },
      subKindCounts,
    });
  } catch (err) {
    console.error("[GET /api/triage] DB error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable", posts: [], total: 0 },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual smoke request (uses dev server — user handles)**

Start dev server if not already running: `npm run dev`
Hit: `curl http://localhost:3000/api/triage?bucket=silent-video`
Expected: JSON with `posts`, `total`, `filteredTotal`, `kindCounts`, `subKindCounts`, `nextCursor`.

Note: this endpoint still responds successfully to the legacy `?type=video` caller (triage count polling). The field name `type` is now just ignored since `buildPostsQuery` handles classification via `kind`/`subKind`. The legacy `TriageFeed` will be deleted in Task 11 before any UI consumer breaks.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/triage/route.ts
git commit -m "refactor(api/triage): delegate to buildPostsQuery, align response with /api/posts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Update `/api/triage/count` to honor kind/subKind

**Files:**
- Modify: `src/app/api/triage/count/route.ts`

- [ ] **Step 1: Replace file contents**

Replace `src/app/api/triage/count/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildPostsQuery, parsePostsFilters } from "@/lib/posts-query";
import type { Prisma } from "@prisma/client";

const REASONS = [
  "silent-video",
  "unchecked-audio",
  "empty",
  "share-only",
  "broken-media",
  "missing-media",
  "dont-post",
];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const { searchParams } = new URL(req.url);
  const filters = parsePostsFilters(searchParams);

  const notReadyBase: Prisma.PostWhereInput[] = [{ readiness: "NOT_READY" }];
  const { where: baseWhere } = buildPostsQuery(filters, userId, {
    extraWhere: notReadyBase,
  });

  const [total, ...reasonCounts] = await Promise.all([
    prisma.post.count({ where: baseWhere }),
    ...REASONS.map((r) => {
      const { where } = buildPostsQuery(filters, userId, {
        extraWhere: [...notReadyBase, { notReadyReasons: { has: r } }],
      });
      return prisma.post.count({ where });
    }),
  ]);

  const byReason: Record<string, number> = {};
  REASONS.forEach((r, i) => {
    byReason[r] = reasonCounts[i] ?? 0;
  });

  return NextResponse.json({ total, byReason });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/triage/count/route.ts
git commit -m "refactor(api/triage/count): honor kind/subKind filters

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extract `PostRow` component from `PostsList.tsx`

**Why:** Isolate the row renderer so it can be reused by `AllPostsView` without carrying the shell logic.

**Files:**
- Create: `src/app/admin/posts/PostRow.tsx`
- Modify: `src/app/admin/posts/PostsList.tsx` (uses new component)

- [ ] **Step 1: Create `PostRow.tsx`**

Create `src/app/admin/posts/PostRow.tsx`. Copy the `RowDeleteButton`, `RowPublishAllButton`, `ALL_PLATFORMS`, `VIDEO_ONLY` constants from the top of `PostsList.tsx` (lines ~133-230) into this file, and then add a `PostRow` component that renders a single row — the JSX currently at lines ~1096-1340 of `PostsList.tsx`.

The file should export:

```tsx
"use client";

import Link from "next/link";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Image as ImageIcon,
  Trash2,
  Send,
  RefreshCw,
  VolumeX,
  Link as LinkIcon,
  Video,
  Images,
  FileText,
  BarChart3,
} from "lucide-react";
import { useCallback } from "react";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
import { PlatformIcons } from "../scheduled/PlatformIcons";
import { displayBody } from "@/lib/post-body";

// Keep the same Post shape used by PostsList
export interface PostRowData {
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
  analytics: { platform: string; reactions: number | null; comments: number | null; shares: number | null }[];
  rating: { stars: number } | null;
  captionQuality: number | null;
  captionEvergreen: boolean | null;
  captionSuggestion: string | null;
}

const ALL_PLATFORMS = [
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  "FACEBOOK_PAGE",
] as const;
const VIDEO_ONLY = new Set(["YOUTUBE", "TIKTOK"]);

function RowDeleteButton({ postId, onDeleted }: { postId: string; onDeleted: () => void }) {
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
        confirming ? "text-amber-500" : "text-gray-300 hover:text-red-500"
      }`}
      onClick={(e) => {
        e.preventDefault();
        trigger();
      }}
      title={confirming ? "Click again to confirm" : "Delete post"}
    >
      {isLoading ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}

function RowPublishAllButton({ post }: { post: PostRowData }) {
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

export interface PostRowProps {
  post: PostRowData;
  index: number;
  isSelected: boolean;
  href: string;
  onCheckboxClick: (e: React.MouseEvent, postId: string, index: number) => void;
  onDeleted: (postId: string) => void;
}

export function PostRow({ post, index, isSelected, href, onCheckboxClick, onDeleted }: PostRowProps) {
  // Copy the inner JSX from PostsList.tsx for a single row (the map body from
  // lines ~1099-1340), replacing the outer wrapper's className to use the
  // `isSelected` prop and wiring the delete callback to onDeleted(post.id).
  // [Reproduce JSX exactly — do not omit markup.]
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border bg-white p-3 transition-shadow hover:shadow-sm md:items-center md:gap-3 md:p-4 ${
        isSelected ? "border-blue-300 bg-blue-50" : "border-gray-200"
      }`}
    >
      <div className="flex-shrink-0 pt-1 md:pt-0">
        <input
          type="checkbox"
          checked={isSelected}
          onClick={(e) => onCheckboxClick(e, post.id, index)}
          onChange={() => {}}
          className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600"
        />
      </div>

      <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 md:items-center md:gap-4">
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
            <img src={post.thumbUrl} alt="" className="h-full w-full object-cover" />
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

        {/* Content — metadata, chips, caption, tags — copied verbatim from PostsList */}
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
                className={`text-xs rounded-full px-2 py-0.5 ${
                  post.captionQuality >= 4
                    ? "bg-green-100 text-green-700"
                    : post.captionQuality <= 2
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-gray-600"
                }`}
                title={`Caption quality: ${post.captionQuality}/5${post.captionEvergreen === false ? " · non-evergreen caption" : ""}${post.captionSuggestion ? " · AI rewrite available" : ""}`}
              >
                {post.captionQuality >= 4 ? "Good" : post.captionQuality === 3 ? "OK" : "Weak"} caption
                {post.captionEvergreen === false ? " · dated" : ""}
                {post.captionSuggestion ? " · rewrite" : ""}
              </span>
            )}
            {(() => {
              const label =
                post.postType && post.postType !== "POST"
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
              void hasImage;
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
            {(() => {
              const fbAnalytics = post.analytics?.find((a) => a.platform === "FACEBOOK");
              if (!fbAnalytics) return null;
              const total = (fbAnalytics.reactions ?? 0) + (fbAnalytics.comments ?? 0) + (fbAnalytics.shares ?? 0);
              return (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                  title={`FB Analytics: ${fbAnalytics.reactions ?? 0} reactions, ${fbAnalytics.comments ?? 0} comments, ${fbAnalytics.shares ?? 0} shares`}
                >
                  <BarChart3 className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline">{total > 0 ? total.toLocaleString() : "FB"}</span>
                </span>
              );
            })()}
          </div>
          {displayBody(post.body) ? (
            <p className="mt-1 line-clamp-2 text-sm text-gray-700">{displayBody(post.body)}</p>
          ) : (
            <p className="mt-1 text-sm italic text-gray-400">No caption</p>
          )}
          {(() => {
            const visibleTags = post.tags;
            return visibleTags.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {visibleTags.slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="hidden rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 sm:inline-block"
                  >
                    {tag}
                  </span>
                ))}
                {visibleTags.length > 0 && (
                  <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 sm:hidden">
                    {visibleTags.length} tags
                  </span>
                )}
                {visibleTags.length > 3 && (
                  <span className="hidden text-xs text-gray-400 sm:inline">+{visibleTags.length - 3} more</span>
                )}
              </div>
            ) : null;
          })()}
        </div>

        <PlatformIcons
          platforms={[
            ...new Set(
              post.publishes.filter((p) => p.status === "PUBLISHED").map((p) => p.platform),
            ),
          ]}
          size={16}
          className="hidden flex-shrink-0 gap-1.5 md:flex"
        />
      </Link>

      <RowPublishAllButton post={post} />
      <RowDeleteButton postId={post.id} onDeleted={() => onDeleted(post.id)} />
    </div>
  );
}
```

- [ ] **Step 2: Update `PostsList.tsx` to import and use `PostRow`**

In `src/app/admin/posts/PostsList.tsx`:

1. Delete the local definitions of `RowDeleteButton`, `RowPublishAllButton`, `ALL_PLATFORMS`, `VIDEO_ONLY` (lines ~133-230).
2. Delete the local `interface Post { ... }` (lines ~63-83); import `PostRowData as Post` from `./PostRow` instead.
3. Add `import { PostRow, type PostRowData } from "./PostRow";` to the imports.
4. Replace the inline row JSX inside the `posts.map(...)` call (lines ~1096-1340) with:

```tsx
{posts.map((post, index) => (
  <PostRow
    key={post.id}
    post={post}
    index={index}
    isSelected={selectedIds.has(post.id)}
    href={postHref(post.id)}
    onCheckboxClick={handleCheckboxClick}
    onDeleted={(id) => {
      setPosts((prev) => prev.filter((p) => p.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setFilteredTotal((t) => Math.max(0, t - 1));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }}
  />
))}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke (user verifies)**

Load `/admin/posts` and confirm: list renders, checkboxes, thumbnails, chips, publish button, delete button all work as before.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/posts/PostRow.tsx src/app/admin/posts/PostsList.tsx
git commit -m "refactor(posts): extract PostRow into its own module

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Create `PostListShell` scaffold + types

**Why:** Introduce the shared shell with minimal behavior first. `PostsList` keeps working untouched while the shell is built.

**Files:**
- Create: `src/app/admin/_shared/PostListShell.types.ts`
- Create: `src/app/admin/_shared/PostListShell.tsx`

- [ ] **Step 1: Create `PostListShell.types.ts`**

Create `src/app/admin/_shared/PostListShell.types.ts`:

```ts
import type { ReactNode } from "react";
import type {
  ContentCategory,
  AudioCategory,
} from "@/lib/posts-query";
import type {
  LinkValue,
  MultiMediaValue,
  TaggedValue,
  ShareValue,
  QualityValue,
  CaptionQualityValue,
  EnrichedValue,
} from "@/app/admin/posts/PostFilterUI";

export type KindFilter = "posts" | "stories";

export interface SharedFilterState {
  search: string;
  sort: string;
  aiTags: string[];
  content: Set<ContentCategory>;
  audio: Set<AudioCategory>;
  link: Set<LinkValue>;
  multiMedia: Set<MultiMediaValue>;
  tagged: Set<TaggedValue>;
  share: Set<ShareValue>;
  quality: Set<QualityValue>;
  captionQuality: Set<CaptionQualityValue>;
  enriched: Set<EnrichedValue>;
  kind: KindFilter;
  subKind: string;
}

export interface ListApiResponse<TPost> {
  posts: TPost[];
  total?: number;
  filteredTotal?: number;
  kindCounts?: { posts: number; stories: number };
  subKindCounts?: Record<string, number>;
  subKindTotals?: Record<string, number>;
  nextCursor: string | null;
}

export interface PostListShellProps<TPost> {
  /** API endpoint that returns ListApiResponse<TPost>, e.g. `/api/posts` or `/api/triage`. */
  apiEndpoint: string;
  /** Extra URLSearchParams that are always merged into every fetch (e.g. bucket for triage). */
  extraParams?: Record<string, string | undefined>;
  /** Page title shown in the header. */
  title: string;
  /** Plural noun used in the count line, e.g. "posts" or "stories". Falls back per-kind. */
  itemNoun?: { singular: string; plural: string };
  /** Optional right-aligned header content (buttons). */
  headerActions?: ReactNode;
  /** Optional content rendered between SubKindTabs and the search row (e.g. triage buckets). */
  beforeList?: ReactNode;
  /** Optional bulk-action bar rendered above the list. */
  bulkBar?: ReactNode;
  /** Optional override of empty-state UI. */
  emptyState?: ReactNode;
  /** Render a single row. Index is position within the current loaded set. */
  renderRow: (post: TPost, index: number) => ReactNode;
  /** If true, hide the kind/subKind tab rows (used by ImprovementsFeed). */
  hideKindTabs?: boolean;
  /** If true, show the select-all row (only for bulk-select consumers). */
  showSelectAll?: boolean;
  /** Called when the user toggles the select-all checkbox. */
  onSelectAllToggle?: (selectAll: boolean, visiblePosts: TPost[]) => void;
  /** Returns true when every visible post is currently selected. */
  allSelected?: boolean;
  /** Key used to derive the href for row-level context (e.g. the detail page). */
  getPostId: (post: TPost) => string;
}
```

- [ ] **Step 2: Create `PostListShell.tsx` skeleton**

Create `src/app/admin/_shared/PostListShell.tsx`. Port the state management + fetch + URL-sync + scroll restoration logic from `src/app/admin/posts/PostsList.tsx` (lines ~259-651). Keep module-level `listCache`. Use `apiEndpoint` instead of hard-coded `/api/posts`. Merge `extraParams` into every fetch. Use props for title + noun. Hide filter menus but mount them identically to `PostsList`. Render `renderRow(post, index)` inside the posts map.

Specifically, the component should:

1. Own all state currently at `PostsList.tsx:259-330` **except** bulk-select state (that stays with consumers).
2. Keep `listCache` at module scope — the per-filter cache key must be unique across consumers, so prepend the `apiEndpoint` to the cache key so `/api/posts` and `/api/triage` caches don't collide.
3. Render:
   - Header: `<h1>{title}</h1>` + "X of Y" count line + `{headerActions}`.
   - `<KindTabs>` + `<SubKindTabs>` (if `!hideKindTabs`).
   - `{beforeList}` (triage buckets, if supplied).
   - Search row with sort/date/filter menus — copied verbatim from `PostsList.tsx:853-962`.
   - `{bulkBar}` (consumer-provided).
   - Loading / empty / error states.
   - `{posts.map((post, index) => renderRow(post, index))}` wrapped in the same `.space-y-2` container.
   - Sentinel div for infinite scroll.
4. Fire the fetch via `fetch(${apiEndpoint}?${buildQueryString(...)})` — `buildQueryString` composes `buildFilterParams(...)` output + `extraParams`.

The body of the component is ~500 lines; the worker should copy the existing `PostsList` logic byte-for-byte and change only:
- `/api/posts` → `apiEndpoint` (with `extraParams` merged in)
- title + noun come from props
- cache key prepended with `apiEndpoint`
- row render swapped for `renderRow(post, index)`

Keep type generic: `export function PostListShell<TPost>(props: PostListShellProps<TPost>) { ... }`. The `post` type flows through via `renderRow` so consumers don't need casts.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/_shared/PostListShell.tsx src/app/admin/_shared/PostListShell.types.ts
git commit -m "feat(_shared): add PostListShell generic shell component

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create `AllPostsView` and swap it into `/admin/posts/page.tsx`

**Why:** Replace `PostsList.tsx` with a thin wrapper around `PostListShell` that owns bulk-select + header actions.

**Files:**
- Create: `src/app/admin/posts/AllPostsView.tsx`
- Modify: `src/app/admin/posts/page.tsx`

- [ ] **Step 1: Create `AllPostsView.tsx`**

Create `src/app/admin/posts/AllPostsView.tsx`. It should:

1. Accept the same `initial*` props as `PostsList` currently does.
2. Own bulk-select state (`selectedIds`, `selectAllMode`, `lastSelectedIndexRef`, `handleCheckboxClick`, `handleBulkDelete`, `bulkAnalyze`, `bulkCaption`, `analyzeJob`, `captionJob`, etc.) — ported from `PostsList.tsx:315-724`.
3. Render `<PostListShell>` with:
   - `apiEndpoint="/api/posts"`
   - `title="All Posts"` (or "All Stories" when `kind === "stories"`)
   - `itemNoun={{ singular: "post", plural: "posts" }}`
   - `headerActions` — the Trash / AI Tag All / Rate Captions / New Post buttons from `PostsList.tsx:738-829`
   - `bulkBar` — the bulk-action bar from `PostsList.tsx:966-1047`
   - `renderRow={(post, index) => <PostRow ... />}` wired to the bulk-select handlers
   - `showSelectAll`, `onSelectAllToggle`, `allSelected` props so the shell renders the select-all row
   - `getPostId={(p) => p.id}`

The component is ~350 lines. The worker should copy from `PostsList.tsx` and remove only the chrome logic that now lives in `PostListShell`.

- [ ] **Step 2: Replace `PostsList` reference in `page.tsx`**

In `src/app/admin/posts/page.tsx`, replace:

```tsx
import { PostsList } from "./PostsList";
```

with:

```tsx
import { AllPostsView } from "./AllPostsView";
```

And change the rendered component name from `<PostsList ...>` to `<AllPostsView ...>` (props unchanged).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: User verifies `/admin/posts`**

Hand off to user: load `/admin/posts` and confirm parity — list renders, filters work, search works, AI search, sort, jump to date, kind/subKind tabs, bulk select, select-all-across-pages, bulk delete, bulk analyze/caption, header buttons, per-row publish+delete, scroll restore on back-nav. Flag any regression.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/posts/AllPostsView.tsx src/app/admin/posts/page.tsx
git commit -m "refactor(posts): render AllPostsView using shared PostListShell

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Create `TriageBuckets` component

**Files:**
- Create: `src/app/admin/triage/TriageBuckets.tsx`

- [ ] **Step 1: Create file**

Create `src/app/admin/triage/TriageBuckets.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

const BUCKETS = [
  { slug: undefined, label: "Needs fixes" },
  { slug: "silent-video", label: "Silent" },
  { slug: "unchecked-audio", label: "Unchecked" },
  { slug: "empty", label: "Empty" },
  { slug: "share-only", label: "Share-only" },
  { slug: "broken-media", label: "Broken" },
  { slug: "missing-media", label: "Missing" },
  { slug: "dont-post", label: "Don't-post" },
] as const;

type BucketSlug = (typeof BUCKETS)[number]["slug"];

export function TriageBuckets() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeBucket: BucketSlug =
    (BUCKETS.find((b) => b.slug === (searchParams.get("bucket") ?? undefined))?.slug) ?? undefined;

  const [counts, setCounts] = useState<{ total: number; byReason: Record<string, number> } | null>(null);

  // Re-fetch counts whenever the filter context (kind, subKind, search, etc.) changes
  const relevantParams = [
    "kind",
    "subKind",
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
  ];
  const paramsKey = relevantParams
    .map((k) => `${k}=${searchParams.get(k) ?? ""}`)
    .join("&");

  useEffect(() => {
    const qs = new URLSearchParams();
    for (const k of relevantParams) {
      const v = searchParams.get(k);
      if (v) qs.set(k, v);
    }
    fetch(`/api/triage/count${qs.toString() ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setCounts(j))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  function selectBucket(slug: BucketSlug) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set("bucket", slug);
    else params.delete("bucket");
    router.push(`${pathname}?${params.toString()}`);
  }

  function countFor(slug: BucketSlug): number {
    if (!counts) return 0;
    if (!slug) return counts.total;
    return counts.byReason[slug] ?? 0;
  }

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
      {BUCKETS.map(({ slug, label }) => {
        const count = countFor(slug);
        const active = activeBucket === slug;
        return (
          <button
            key={slug ?? "all"}
            onClick={() => selectBucket(slug)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-gray-300 text-gray-700"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/triage/TriageBuckets.tsx
git commit -m "feat(triage): extract TriageBuckets pill strip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Create `TriageView` and swap it into `/admin/triage/page.tsx`

**Files:**
- Create: `src/app/admin/triage/TriageView.tsx`
- Modify: `src/app/admin/triage/page.tsx`

- [ ] **Step 1: Create `TriageView.tsx`**

Create `src/app/admin/triage/TriageView.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { PostListShell } from "@/app/admin/_shared/PostListShell";
import { TriageBuckets } from "./TriageBuckets";
import { TriageCard, type TriagePost } from "./TriageCard";

interface Toast {
  id: string;
  message: string;
  savedPost: TriagePost;
}

export function TriageView() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Shell-owned posts are read-only from here; for optimistic dismiss we
  // trigger a refetch via the shell's internal state (re-keyed by URL param
  // changes).
  // For optimistic UI, we keep a local "hidden" set and ask the shell's
  // row renderer to skip any hidden post.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback(
    async (postId: string, action: "mark-ready" | "archive" | "trash", savedPost: TriagePost) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(postId);
        return next;
      });
      if (action !== "trash") {
        const toastId = `${postId}-${Date.now()}`;
        const message = action === "mark-ready" ? "Marked ready" : "Archived";
        setToasts((prev) => [...prev, { id: toastId, message, savedPost }]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, 5000);
      }
    },
    [],
  );

  function undoDismiss(toast: Toast) {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(toast.savedPost.id);
      return next;
    });
    // Note: we rely on the next refetch to restore the row in the list. If the
    // post is out of the current bucket/filter, it correctly won't reappear.
  }

  return (
    <div className="relative">
      <PostListShell<TriagePost>
        apiEndpoint="/api/triage"
        title="Needs fixes"
        itemNoun={{ singular: "post", plural: "posts" }}
        beforeList={<TriageBuckets />}
        getPostId={(p) => p.id}
        renderRow={(post) => {
          if (hiddenIds.has(post.id)) return null;
          return (
            <TriageCard
              key={post.id}
              post={post}
              onDismiss={(id, action) => {
                handleDismiss(id, action, post);
              }}
            />
          );
        }}
      />

      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"
            >
              <span>{t.message}</span>
              <button
                onClick={() => undoDismiss(t)}
                className="font-semibold text-blue-300 hover:text-blue-200"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `TriageFeed` reference in `page.tsx`**

Edit `src/app/admin/triage/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TriageView } from "./TriageView";
import { TriageTabs } from "./TriageTabs";

export const metadata = { title: "Triage" };

export default async function TriagePage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl">
      <TriageTabs active="needs-fixes" />
      <TriageView />
    </div>
  );
}
```

(The subtitle and `<h1>Triage</h1>` header are now rendered inside `PostListShell` via the `title` prop.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: User verifies `/admin/triage`**

Hand off to user: load `/admin/triage` and confirm — bucket pills work, search/sort/date/filters work, kind/subKind tabs work, swipe gestures still work, inline fixes still work, undo toast still appears.

- [ ] **Step 5: Commit**

```bash
git add src/app/admin/triage/TriageView.tsx src/app/admin/triage/page.tsx
git commit -m "refactor(triage): render TriageView using shared PostListShell

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Wrap `ImprovementsFeed` header in the shared shell

**Why:** Align the "AI suggestions" page header (title + search/sort/jump-to-date) with the other two pages. Body stays the current feed.

**Files:**
- Modify: `src/app/admin/triage/improvements/ImprovementsFeed.tsx`
- Modify: `src/app/admin/triage/improvements/page.tsx`

- [ ] **Step 1: Update `ImprovementsFeed.tsx`**

Open `src/app/admin/triage/improvements/ImprovementsFeed.tsx`. Change the top-level wrapper to:

```tsx
return (
  <div className="mx-auto max-w-3xl">
    <div className="mb-4">
      <h1 className="text-2xl font-bold text-gray-900">AI suggestions</h1>
      <p className="mt-1 text-sm text-gray-500">
        AI-suggested caption rewrites for low-quality or non-evergreen posts.
      </p>
    </div>
    {/* existing body (filter counts + items + sentinel + loading more) */}
    ...
  </div>
);
```

(No backend changes here — the improvements list has its own API `/api/triage/improvements` and its own query shape. Section 3 of the spec deferred adding search/sort/jump-to-date to this page; skip for now and revisit if the user asks.)

- [ ] **Step 2: Update `improvements/page.tsx`**

Ensure `page.tsx` renders the cleaned-up view (title + subtitle now live in the feed, so remove the duplicate header):

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ImprovementsFeed } from "./ImprovementsFeed";
import { TriageTabs } from "../TriageTabs";

export const metadata = { title: "AI suggestions" };

export default async function ImprovementsPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl">
      <TriageTabs active="ai-suggestions" />
      <ImprovementsFeed />
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/admin/triage/improvements/ImprovementsFeed.tsx src/app/admin/triage/improvements/page.tsx
git commit -m "refactor(triage/improvements): align header with triage view

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Delete superseded files

**Why:** `PostsList.tsx` and `TriageFeed.tsx` are no longer referenced; clean them up.

**Files:**
- Delete: `src/app/admin/posts/PostsList.tsx`
- Delete: `src/app/admin/triage/TriageFeed.tsx`

- [ ] **Step 1: Grep for remaining references**

Run:

```bash
rg -l "from.*PostsList|from.*TriageFeed" src/
```

Expected: zero matches. If there are matches, stop and update them first (a missed consumer means tasks 7 or 9 were incomplete).

- [ ] **Step 2: Delete the files**

```bash
git rm src/app/admin/posts/PostsList.tsx src/app/admin/triage/TriageFeed.tsx
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the vitest suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore: remove superseded PostsList and TriageFeed

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Final verification + push + PR

- [ ] **Step 1: Full type-check + tests**

```bash
npx tsc --noEmit
npm test
```

Both must pass.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feature/triage-allposts-unify
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Unify triage + all-posts page chrome via PostListShell" --body "$(cat <<'EOF'
## Summary
- Introduces `PostListShell` at `src/app/admin/_shared/` — a shared headless component that owns the chrome (title, kind/subKind tabs, search, sort, jump-to-date, filters menu, URL sync, infinite scroll, scroll restoration) for both /admin/posts and /admin/triage.
- `/admin/posts` now renders `AllPostsView` (shell + compact PostRow + bulk-select + header actions).
- `/admin/triage` now renders `TriageView` (shell + TriageCard + TriageBuckets + `readiness=NOT_READY` preset).
- Tab renames: `Readiness` → `Needs fixes`, `Post improvements` → `AI suggestions`.
- `/api/triage` now delegates to the same `buildPostsQuery` helper as `/api/posts` and returns an aligned response shape.
- Removes the now-superseded `PostsList.tsx` and `TriageFeed.tsx`.

## Test plan
- [ ] /admin/posts: list renders, filters (content/audio/link/multimedia/tagged/share/quality/captionQuality/enriched), sort, jump to date, search (keyword + AI), kind/subKind tabs, bulk select, select-all-across-pages, bulk delete, bulk analyze/caption, per-row publish+delete, scroll restore on back-nav.
- [ ] /admin/triage: bucket pills (counts reflect current slice), search/sort/jump-to-date/filters, kind/subKind tabs, swipe gestures, inline fixes, undo toast.
- [ ] /admin/triage/improvements: new title + subtitle, accept/dismiss flow unchanged.
- [ ] Tab labels updated on both triage pages.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL.

---

## Self-review notes (spec ↔ plan coverage)

- **Shared shell + URL params** — Tasks 6, 7, 9.
- **Triage bucket pill strip** — Task 8 (counts re-fetch on kind/subKind change).
- **Tab renames** — Task 1.
- **Triage type-tab consolidation** — Task 9 (removing the Videos/Images/Stories tabs is implicit by swapping `TriageFeed` for `TriageView`; `TriageView` does not render the old tabs).
- **API alignment** — Tasks 3, 4.
- **AI suggestions chrome** — Task 10 (header-only as designed).
- **File deletions** — Task 11.
- **Shared `extraWhere` hook on `buildPostsQuery`** — Task 2.

No placeholders remain. Type/signature consistency verified: `PostRowProps` in Task 5 matches use in Task 7; `SharedFilterState` in Task 6 matches shell internals; `extraWhere` signature in Task 2 matches consumers in Tasks 3 and 4.
