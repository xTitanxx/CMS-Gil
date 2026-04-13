# Public Archive + Admin Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public scrollable post archive at `/` (with shareable `/p/[id]` pages) and migrate all admin routes to `/admin/*`.

**Architecture:** Rename `src/app/(dashboard)` to `src/app/admin` (turning the URL-invisible route group into a real URL segment). Add two new public routes (`/` for feed, `/p/[id]` for individual post) with their own minimal layouts. Update all internal links and redirects from `/dashboard`, `/posts`, etc. to `/admin/*`.

**Tech Stack:** Next.js 16 App Router, Prisma 7, React 19, TypeScript

**Spec:** `docs/superpowers/specs/2026-04-13-public-archive-and-admin-split-design.md`

---

### Task 1: Deduplicated Public Posts Query

**Files:**
- Create: `src/lib/public-posts.ts`
- Create: `src/lib/public-posts.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/public-posts.test.ts
import { describe, it, expect } from "vitest";
import { dedupePosts, type PublicPost } from "./public-posts";

function makePost(id: string, bodyNormalized: string, date: string): PublicPost {
  return {
    id,
    body: bodyNormalized,
    bodyNormalized,
    originalDate: new Date(date),
    tags: [],
    media: [],
  };
}

describe("dedupePosts", () => {
  it("returns posts unchanged when no duplicates exist", () => {
    const posts = [
      makePost("a", "hello world", "2026-01-01"),
      makePost("b", "second post", "2026-01-02"),
    ];
    expect(dedupePosts(posts).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("keeps the oldest post when bodyNormalized duplicates exist", () => {
    // Input ordered newest first (simulates DB result)
    const posts = [
      makePost("newer", "same text", "2026-02-01"),
      makePost("older", "same text", "2026-01-01"),
      makePost("unique", "different", "2026-01-15"),
    ];
    const result = dedupePosts(posts);
    expect(result.map((p) => p.id).sort()).toEqual(["older", "unique"]);
  });

  it("does not dedupe posts with empty bodyNormalized", () => {
    const posts = [
      makePost("a", "", "2026-01-01"),
      makePost("b", "", "2026-01-02"),
    ];
    expect(dedupePosts(posts)).toHaveLength(2);
  });

  it("preserves original order (newest first) after dedup", () => {
    const posts = [
      makePost("a", "one", "2026-03-01"),
      makePost("b", "two", "2026-02-01"),
      makePost("c", "one", "2026-01-01"), // dup of a, older
    ];
    const result = dedupePosts(posts);
    // 'a' is replaced by 'c' (older), but 'c' keeps its original date position? No:
    // the function keeps 'c' as the survivor. Result should be ordered by date desc.
    expect(result.map((p) => p.id)).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/public-posts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
// src/lib/public-posts.ts
import { prisma } from "@/lib/prisma";

export interface PublicPostMedia {
  id: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

export interface PublicPost {
  id: string;
  body: string;
  bodyNormalized: string;
  originalDate: Date;
  tags: string[];
  media: PublicPostMedia[];
}

/**
 * Remove posts whose bodyNormalized matches an earlier post.
 * Among duplicates, keep the oldest (earliest originalDate).
 * Posts with empty bodyNormalized are never deduped.
 * Returns posts in originalDate descending order.
 */
export function dedupePosts(posts: PublicPost[]): PublicPost[] {
  const byBody = new Map<string, PublicPost>();
  const nonDedupable: PublicPost[] = [];

  for (const p of posts) {
    if (!p.bodyNormalized) {
      nonDedupable.push(p);
      continue;
    }
    const existing = byBody.get(p.bodyNormalized);
    if (!existing || p.originalDate < existing.originalDate) {
      byBody.set(p.bodyNormalized, p);
    }
  }

  const result = [...byBody.values(), ...nonDedupable];
  result.sort((a, b) => b.originalDate.getTime() - a.originalDate.getTime());
  return result;
}

const PAGE_SIZE = 20;

export async function getPublicFeedPage(cursor?: {
  date: Date;
  id: string;
}): Promise<{ posts: PublicPost[]; nextCursor: { date: Date; id: string } | null }> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  // Fetch a larger window than needed, so that after dedup we still have enough
  // for a full page. 3x page size is a pragmatic buffer.
  const fetchSize = PAGE_SIZE * 3;

  const where = cursor
    ? {
        userId: gilUserId,
        OR: [
          { originalDate: { lt: cursor.date } },
          { originalDate: cursor.date, id: { lt: cursor.id } },
        ],
      }
    : { userId: gilUserId };

  const raw = await prisma.post.findMany({
    where,
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
        },
      },
    },
    orderBy: [{ originalDate: "desc" }, { id: "desc" }],
    take: fetchSize,
  });

  const deduped = dedupePosts(raw);
  const page = deduped.slice(0, PAGE_SIZE);

  const nextCursor =
    page.length === PAGE_SIZE
      ? { date: page[page.length - 1].originalDate, id: page[page.length - 1].id }
      : null;

  return { posts: page, nextCursor };
}

export async function getPublicPost(id: string): Promise<PublicPost | null> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const post = await prisma.post.findFirst({
    where: { id, userId: gilUserId },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
        },
      },
    },
  });

  return post;
}

export async function getRelatedPosts(
  post: PublicPost,
  limit = 5
): Promise<PublicPost[]> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  if (post.tags.length === 0) {
    // No tags — fall back to chronologically adjacent posts.
    const candidates = await prisma.post.findMany({
      where: { userId: gilUserId, id: { not: post.id } },
      select: {
        id: true,
        body: true,
        bodyNormalized: true,
        originalDate: true,
        tags: true,
        media: {
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            width: true,
            height: true,
            altText: true,
          },
        },
      },
      orderBy: { originalDate: "desc" },
      take: limit * 3,
    });
    return dedupePosts(candidates).slice(0, limit);
  }

  // Find candidates sharing any tag, then rank by overlap count.
  const candidates = await prisma.post.findMany({
    where: {
      userId: gilUserId,
      id: { not: post.id },
      tags: { hasSome: post.tags },
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
        },
      },
    },
    take: limit * 5,
  });

  const scored = candidates
    .map((c) => ({
      post: c,
      overlap: c.tags.filter((t) => post.tags.includes(t)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.post.originalDate.getTime() - a.post.originalDate.getTime());

  return dedupePosts(scored.map((s) => s.post)).slice(0, limit);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/public-posts.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/public-posts.ts src/lib/public-posts.test.ts
git commit -m "feat(public): add deduplicated public posts query helpers"
```

---

### Task 2: Public Feed API Route

**Files:**
- Create: `src/app/api/public/feed/route.ts`

- [ ] **Step 1: Create the feed API route**

```typescript
// src/app/api/public/feed/route.ts
import { NextRequest } from "next/server";
import { getPublicFeedPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cursorDate = searchParams.get("cursorDate");
  const cursorId = searchParams.get("cursorId");

  const cursor =
    cursorDate && cursorId
      ? { date: new Date(cursorDate), id: cursorId }
      : undefined;

  const { posts, nextCursor } = await getPublicFeedPage(cursor);

  const postsWithMediaUrls = await Promise.all(
    posts.map(async (p) => ({
      id: p.id,
      body: p.body,
      originalDate: p.originalDate,
      tags: p.tags,
      media: await Promise.all(
        p.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  return Response.json({
    posts: postsWithMediaUrls,
    nextCursor,
  });
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: no new errors introduced by this file

- [ ] **Step 3: Commit**

```bash
git add src/app/api/public/feed/route.ts
git commit -m "feat(public): add public feed API with cursor pagination"
```

---

### Task 3: Public Feed UI Component (client-side infinite scroll)

**Files:**
- Create: `src/app/PublicFeed.tsx`

- [ ] **Step 1: Create the client component**

```tsx
// src/app/PublicFeed.tsx
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";

interface Media {
  id: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  url: string | null;
}

interface FeedPost {
  id: string;
  body: string;
  originalDate: string;
  tags: string[];
  media: Media[];
}

interface FeedPage {
  posts: FeedPost[];
  nextCursor: { date: string; id: string } | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function PostCard({ post }: { post: FeedPost }) {
  return (
    <Link
      href={`/p/${post.id}`}
      className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
    >
      <p className="text-xs text-gray-500 mb-2">{formatDate(post.originalDate)}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap mb-3">{post.body}</p>
      {post.media.length > 0 && (
        <div className="flex flex-col gap-2">
          {post.media.map((m) =>
            m.url && m.mimeType.startsWith("video/") ? (
              <video
                key={m.id}
                src={m.url}
                controls
                className="rounded max-w-full"
                preload="metadata"
              />
            ) : m.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={m.url}
                alt={m.altText ?? ""}
                className="rounded max-w-full h-auto"
              />
            ) : null
          )}
        </div>
      )}
    </Link>
  );
}

export function PublicFeed({ initial }: { initial: FeedPage }) {
  const [posts, setPosts] = useState<FeedPost[]>(initial.posts);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        cursorDate: cursor.date,
        cursorId: cursor.id,
      });
      const res = await fetch(`/api/public/feed?${params}`);
      if (!res.ok) return;
      const data: FeedPage = await res.json();
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        loadMore();
      }
    });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  return (
    <div className="flex flex-col gap-3">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {cursor && (
        <div ref={sentinelRef} className="py-8 text-center text-xs text-gray-400">
          {loading ? "Loading..." : " "}
        </div>
      )}
      {!cursor && posts.length > 0 && (
        <p className="py-8 text-center text-xs text-gray-400">That's the beginning.</p>
      )}
      {posts.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-500">No posts yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/PublicFeed.tsx
git commit -m "feat(public): add client-side infinite scroll feed component"
```

---

### Task 4: Admin Folder Rename + `/admin` Index Redirect

**Files:**
- Rename folder: `src/app/(dashboard)/` → `src/app/admin/`
- Create: `src/app/admin/page.tsx`

- [ ] **Step 1: Rename the folder**

```bash
git mv "src/app/(dashboard)" src/app/admin
```

- [ ] **Step 2: Create `/admin` index redirect**

```typescript
// src/app/admin/page.tsx
import { redirect } from "next/navigation";

export default function AdminIndex() {
  redirect("/admin/dashboard");
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/page.tsx
git commit -m "refactor: move dashboard routes under /admin prefix"
```

---

### Task 5: Update All Internal Links to `/admin/*`

**Files:**
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/app/(auth)/login/SignInButtons.tsx`
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/app/admin/trash/[dir]/page.tsx`
- Modify: `src/app/admin/trash/[dir]/TrashActions.tsx`
- Modify: `src/app/admin/trash/[dir]/post/[postId]/page.tsx`
- Modify: `src/app/admin/posts/[id]/PostInteractions.tsx`
- Modify: `src/app/admin/posts/[id]/page.tsx`
- Modify: `src/app/admin/posts/PostsList.tsx`
- Modify: `src/app/admin/posts/PostsFeed.tsx`
- Modify: `src/app/admin/posts/new/page.tsx`
- Modify: `src/app/admin/dashboard/PlanSlotRow.tsx`
- Modify: `src/app/admin/scheduled/DayPanel.tsx`

- [ ] **Step 1: Update Sidebar nav hrefs**

In `src/components/layout/Sidebar.tsx`, update the nav array:

```typescript
const nav = [
  { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/posts", label: "All Posts", icon: FileText },
  { href: "/admin/import", label: "Import", icon: Upload },
  { href: "/admin/connections", label: "Connections", icon: Link2 },
  { href: "/admin/scheduled", label: "Scheduled", icon: CalendarClock },
  { href: "/admin/todo", label: "To-Do", icon: CheckSquare },
];
```

(Keep everything else the same — the signOut callbackUrl stays `/login`.)

- [ ] **Step 2: Update SignInButtons — update Google callback + remove LinkedIn**

In `src/app/(auth)/login/SignInButtons.tsx`, replace the entire return block:

```tsx
return (
  <div className="flex flex-col gap-3">
    <Button
      onClick={() => signIn("google", { callbackUrl: "/admin/dashboard" })}
      variant="outline"
      className="w-full gap-3"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4">
        <path
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          fill="#4285F4"
        />
        <path
          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          fill="#34A853"
        />
        <path
          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
          fill="#FBBC05"
        />
        <path
          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          fill="#EA4335"
        />
      </svg>
      Continue with Google
    </Button>
  </div>
);
```

- [ ] **Step 3: Update login page redirect**

In `src/app/(auth)/login/page.tsx`, replace `redirect("/dashboard")` with `redirect("/admin/dashboard")`.

- [ ] **Step 4: Replace all remaining admin route references**

In every modified file listed above, replace these literal strings (only when they appear as route hrefs / redirects / router.push values — NOT in `/api/*` paths):

- `"/dashboard"` → `"/admin/dashboard"`
- `"/posts"` → `"/admin/posts"`
- `"/posts/${...}"` → `"/admin/posts/${...}"` (template literals)
- `"/posts/new"` → `"/admin/posts/new"`
- `"/import"` → `"/admin/import"`
- `"/connections"` → `"/admin/connections"`
- `"/scheduled"` → `"/admin/scheduled"`
- `"/todo"` → `"/admin/todo"`
- `"/trash"` → `"/admin/trash"`
- `"/trash/..."` → `"/admin/trash/..."`

Specifically the following lines (from the exploration report) must change:

- `src/app/admin/trash/[dir]/page.tsx`: `redirect("/trash")` → `redirect("/admin/trash")`
- `src/app/admin/trash/[dir]/TrashActions.tsx`: both `router.push("/trash")` → `router.push("/admin/trash")`
- `src/app/admin/trash/[dir]/post/[postId]/page.tsx`: `href="/trash"` → `href="/admin/trash"`
- `src/app/admin/posts/[id]/PostInteractions.tsx`: `router.push("/posts")` → `router.push("/admin/posts")`
- `src/app/admin/posts/[id]/page.tsx`: all `/posts` and `/dashboard` hrefs → `/admin/posts` and `/admin/dashboard`
- `src/app/admin/posts/PostsList.tsx`: `href="/posts/new"` → `href="/admin/posts/new"`; template literal `/posts/${id}?...` → `/admin/posts/${id}?...`; `href="/trash"` → `href="/admin/trash"`; `href="/import"` → `href="/admin/import"`
- `src/app/admin/posts/PostsFeed.tsx`: same substitutions as PostsList
- `src/app/admin/posts/new/page.tsx`: both `href="/posts"` → `href="/admin/posts"`
- `src/app/admin/dashboard/PlanSlotRow.tsx`: both `href={`/posts/${post.id}?from=dashboard`}` → `href={`/admin/posts/${post.id}?from=dashboard`}` (keep query string unchanged)
- `src/app/admin/scheduled/DayPanel.tsx`: `href={`/posts/${e.postId}`}` → `href={`/admin/posts/${e.postId}`}`

Do NOT change `/api/*` paths anywhere — those are API routes unaffected by this migration.

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: update all internal links to /admin/* prefix; remove LinkedIn login"
```

---

### Task 6: Public Feed Home Page (`/`)

**Files:**
- Modify: `src/app/page.tsx` (full rewrite)
- Create: `src/app/(public)/layout.tsx`

Note: We'll introduce a `(public)` route group for the public layout. This lets the root page and post pages share a minimal messenger-style layout without affecting admin.

- [ ] **Step 1: Move root page into `(public)` group**

Actually, route groups can share a layout without moving files. We'll create `src/app/(public)/layout.tsx`, but since `src/app/page.tsx` is not inside `(public)`, it won't inherit that layout. Instead, put the public layout at the root's `src/app/layout.tsx` level (which is already where the root layout lives). The root layout stays minimal.

For simplicity, we'll:
1. Rewrite `src/app/page.tsx` to render the public feed
2. Put the public post page at `src/app/p/[id]/page.tsx` with its own layout

Skip creating `(public)/layout.tsx` — the existing `src/app/layout.tsx` with `SessionProvider` already wraps everything and doesn't force auth. That's fine for the public pages.

- [ ] **Step 2: Rewrite `src/app/page.tsx`**

```tsx
// src/app/page.tsx
import { getPublicFeedPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { PublicFeed } from "./PublicFeed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { posts, nextCursor } = await getPublicFeedPage();

  const postsWithUrls = await Promise.all(
    posts.map(async (p) => ({
      id: p.id,
      body: p.body,
      originalDate: p.originalDate.toISOString(),
      tags: p.tags,
      media: await Promise.all(
        p.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  const initial = {
    posts: postsWithUrls,
    nextCursor: nextCursor
      ? { date: nextCursor.date.toISOString(), id: nextCursor.id }
      : null,
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-6">
        <header className="flex items-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white font-semibold text-lg">
            G
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Gil Alter</h1>
            <p className="text-xs text-gray-500">Posts about MS, breathwork, depression, and more</p>
          </div>
        </header>
        <PublicFeed initial={initial} />
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Type check and smoke test**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(public): public feed at / with infinite scroll"
```

---

### Task 7: Individual Public Post Page (`/p/[id]`)

**Files:**
- Create: `src/app/p/[id]/page.tsx`
- Create: `src/app/p/[id]/BackButton.tsx`

- [ ] **Step 1: Create the BackButton client component**

```tsx
// src/app/p/[id]/BackButton.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function BackButton() {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  if (canGoBack) {
    return (
      <button
        onClick={() => router.back()}
        className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
      >
        ← Back to feed
      </button>
    );
  }

  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
    >
      ← Back to feed
    </Link>
  );
}
```

- [ ] **Step 2: Create the post page**

```tsx
// src/app/p/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicPost, getRelatedPosts } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { BackButton } from "./BackButton";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function mediaWithUrls<T extends { storageKey: string; mimeType: string; id: string; altText: string | null }>(
  media: T[]
) {
  return Promise.all(
    media.map(async (m) => ({
      id: m.id,
      altText: m.altText,
      mimeType: m.mimeType,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
        () => null
      ),
    }))
  );
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const post = await getPublicPost(id);
  if (!post) notFound();

  const related = await getRelatedPosts(post, 5);

  const mainMedia = await mediaWithUrls(post.media);
  const relatedWithUrls = await Promise.all(
    related.map(async (r) => ({
      ...r,
      mediaWithUrls: await mediaWithUrls(r.media),
    }))
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="mb-4">
          <BackButton />
        </div>

        <article className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-3">{formatDate(post.originalDate)}</p>
          <p className="text-sm text-gray-800 whitespace-pre-wrap mb-4">{post.body}</p>
          {mainMedia.length > 0 && (
            <div className="flex flex-col gap-2">
              {mainMedia.map((m) =>
                m.url && m.mimeType.startsWith("video/") ? (
                  <video
                    key={m.id}
                    src={m.url}
                    controls
                    className="rounded max-w-full"
                    preload="metadata"
                  />
                ) : m.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.altText ?? ""}
                    className="rounded max-w-full h-auto"
                  />
                ) : null
              )}
            </div>
          )}
        </article>

        {relatedWithUrls.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Related posts</h2>
            <div className="flex flex-col gap-3">
              {relatedWithUrls.map((r) => (
                <Link
                  key={r.id}
                  href={`/p/${r.id}`}
                  className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                >
                  <p className="text-xs text-gray-500 mb-2">{formatDate(r.originalDate)}</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap line-clamp-3">
                    {r.body}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/app/p/[id]/page.tsx src/app/p/[id]/BackButton.tsx
git commit -m "feat(public): individual post page at /p/[id] with related posts"
```

---

### Task 8: Smoke Test

**Files:** None — manual verification

- [ ] **Step 1: Restart dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev &> /tmp/nextdev.log &
```

- [ ] **Step 2: Public feed**

Open `http://localhost:3000/` in an incognito window. Verify:
- Feed loads without redirect
- Posts appear with date + body + media
- Scrolling to the bottom triggers loading more posts
- No duplicate posts appear

- [ ] **Step 3: Individual post page**

Click a post in the feed. Verify:
- URL changes to `/p/<id>`
- Full post is shown
- "Related posts" section appears below (if the post has tags, should show 3-5 posts; if no tags, shows chronologically nearby posts)
- "← Back to feed" button works (returns to previous page)
- Opening `/p/<id>` in a new tab shows the same post, and the back button links to `/`

- [ ] **Step 4: Admin migration**

Visit `http://localhost:3000/admin/dashboard` (while logged in). Verify:
- All admin pages load: `/admin/dashboard`, `/admin/posts`, `/admin/import`, `/admin/connections`, `/admin/scheduled`, `/admin/todo`, `/admin/trash`
- Sidebar links go to `/admin/*` routes (not `/dashboard`, `/posts`, etc.)
- Clicking a post in the admin posts list goes to `/admin/posts/[id]`
- Post editor "back" links go to `/admin/posts`
- Trash restore/delete goes back to `/admin/trash`

- [ ] **Step 5: Old routes should 404**

Visit `http://localhost:3000/dashboard` and `http://localhost:3000/posts`. Both should return a 404 (Next.js default not-found page).

- [ ] **Step 6: Login flow**

Log out. Visit `/login`. Verify:
- Only the "Continue with Google" button appears (LinkedIn is gone)
- After Google sign-in, you land on `/admin/dashboard`

- [ ] **Step 7: Type check and test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: No new errors; existing test count remains (pre-existing `posts-query` failure is unrelated).

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(public): adjustments from smoke testing"
```
