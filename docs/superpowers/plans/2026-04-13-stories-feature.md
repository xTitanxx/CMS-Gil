# Stories Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate stories from posts in the public archive. Add Facebook-style horizontal stories row at the top of `/` with a full-screen auto-advancing viewer, and a shareable `/s/[id]` route.

**Spec:** `docs/superpowers/specs/2026-04-13-stories-feature-design.md`

---

### Task 1: Backend — Stories Query + Feed Filter

**Files:**
- Modify: `src/lib/public-posts.ts`
- Modify: `src/lib/public-posts.test.ts`

- [ ] **Step 1: Add `isStory` helper + new queries**

In `src/lib/public-posts.ts`, add:

```typescript
export function isStory(sourceId: string | null | undefined): boolean {
  return !!sourceId && sourceId.startsWith("fb_story_");
}
```

And update the types to include `sourceId`:

```typescript
export interface PublicPost {
  id: string;
  body: string;
  bodyNormalized: string;
  originalDate: Date;
  tags: string[];
  sourceId: string | null;
  media: PublicPostMedia[];
}
```

Update all three existing functions (`getPublicFeedPage`, `getPublicPost`, `getRelatedPosts`) to include `sourceId: true` in their Prisma `select`.

Then add to the `where` clause in `getPublicFeedPage`:

```typescript
const where = cursor
  ? {
      userId: gilUserId,
      NOT: { sourceId: { startsWith: "fb_story_" } },
      OR: [
        { originalDate: { lt: cursor.date } },
        { originalDate: cursor.date, id: { lt: cursor.id } },
      ],
    }
  : { userId: gilUserId, NOT: { sourceId: { startsWith: "fb_story_" } } };
```

Add new exported functions:

```typescript
export async function getPublicStoriesPage(cursor?: {
  date: Date;
  id: string;
}): Promise<{ stories: PublicPost[]; nextCursor: { date: Date; id: string } | null }> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const pageSize = 30;

  const where = cursor
    ? {
        userId: gilUserId,
        sourceId: { startsWith: "fb_story_" },
        OR: [
          { originalDate: { lt: cursor.date } },
          { originalDate: cursor.date, id: { lt: cursor.id } },
        ],
      }
    : { userId: gilUserId, sourceId: { startsWith: "fb_story_" } };

  const stories = await prisma.post.findMany({
    where,
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
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
    take: pageSize,
  });

  const filtered = stories.filter((s) => s.media.length > 0);

  const nextCursor =
    stories.length === pageSize
      ? {
          date: stories[stories.length - 1].originalDate,
          id: stories[stories.length - 1].id,
        }
      : null;

  return { stories: filtered, nextCursor };
}

export async function getPublicStory(id: string): Promise<PublicPost | null> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const story = await prisma.post.findFirst({
    where: {
      id,
      userId: gilUserId,
      sourceId: { startsWith: "fb_story_" },
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
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

  return story;
}
```

- [ ] **Step 2: Update existing test to include `sourceId` field**

In `src/lib/public-posts.test.ts`, the `makePost` helper needs updating:

```typescript
function makePost(id: string, bodyNormalized: string, date: string): PublicPost {
  return {
    id,
    body: bodyNormalized,
    bodyNormalized,
    originalDate: new Date(date),
    tags: [],
    sourceId: null,
    media: [],
  };
}
```

- [ ] **Step 3: Add test for isStory**

Add to `src/lib/public-posts.test.ts`:

```typescript
import { isStory } from "./public-posts";

describe("isStory", () => {
  it("returns true for fb_story_ sourceIds", () => {
    expect(isStory("fb_story_abc123")).toBe(true);
  });
  it("returns false for fb_ sourceIds without story prefix", () => {
    expect(isStory("fb_abc123")).toBe(false);
  });
  it("returns false for null/undefined/empty", () => {
    expect(isStory(null)).toBe(false);
    expect(isStory(undefined)).toBe(false);
    expect(isStory("")).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/public-posts.test.ts`
Expected: All tests PASS (previous 4 + 3 new = 7)

- [ ] **Step 5: Commit**

```bash
git add src/lib/public-posts.ts src/lib/public-posts.test.ts
git commit -m "feat(stories): add stories query helpers and exclude stories from feed"
```

---

### Task 2: Stories API Route

**Files:**
- Create: `src/app/api/public/stories/route.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/app/api/public/stories/route.ts
import { NextRequest } from "next/server";
import { getPublicStoriesPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cursorDate = searchParams.get("cursorDate");
  const cursorId = searchParams.get("cursorId");

  const cursor =
    cursorDate && cursorId
      ? { date: new Date(cursorDate), id: cursorId }
      : undefined;

  const { stories, nextCursor } = await getPublicStoriesPage(cursor);

  const storiesWithUrls = await Promise.all(
    stories.map(async (s) => ({
      id: s.id,
      originalDate: s.originalDate,
      media: await Promise.all(
        s.media.map(async (m) => ({
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

  return Response.json({ stories: storiesWithUrls, nextCursor });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/public/stories/route.ts
git commit -m "feat(stories): add public stories API with cursor pagination"
```

---

### Task 3: Stories Row Component (horizontal scrollable thumbnails)

**Files:**
- Create: `src/app/StoriesRow.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/app/StoriesRow.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StoryViewer } from "./StoryViewer";

interface StoryMedia {
  id: string;
  mimeType: string;
  url: string | null;
}

export interface Story {
  id: string;
  originalDate: string;
  media: StoryMedia[];
}

interface StoriesPage {
  stories: Story[];
  nextCursor: { date: string; id: string } | null;
}

export function StoriesRow({ initial }: { initial: StoriesPage }) {
  const [stories, setStories] = useState<Story[]>(initial.stories);
  const [cursor, setCursor] = useState(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        cursorDate: cursor.date,
        cursorId: cursor.id,
      });
      const res = await fetch(`/api/public/stories?${params}`);
      if (!res.ok) return;
      const data: StoriesPage = await res.json();
      setStories((prev) => [...prev, ...data.stories]);
      setCursor(data.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMore();
      },
      { root: sentinelRef.current.parentElement, threshold: 0.1 }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, cursor]);

  if (stories.length === 0) return null;

  return (
    <>
      <div className="mb-4 -mx-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 px-4 pb-2">
          {stories.map((s, i) => (
            <StoryThumbnail
              key={s.id}
              story={s}
              onClick={() => setViewerIndex(i)}
            />
          ))}
          {cursor && (
            <div
              ref={sentinelRef}
              className="flex-shrink-0 w-16 h-16 flex items-center justify-center text-xs text-gray-400"
            >
              {loading ? "..." : ""}
            </div>
          )}
        </div>
      </div>
      {viewerIndex !== null && (
        <StoryViewer
          stories={stories}
          startIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onRequestLoadMore={loadMore}
          hasMore={!!cursor}
        />
      )}
    </>
  );
}

function StoryThumbnail({ story, onClick }: { story: Story; onClick: () => void }) {
  const firstMedia = story.media[0];
  if (!firstMedia?.url) return null;

  const isVideo = firstMedia.mimeType.startsWith("video/");

  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 rounded-full p-[2px] bg-gradient-to-tr from-blue-500 to-purple-500"
    >
      <div className="h-16 w-16 rounded-full overflow-hidden bg-gray-200 border-2 border-white">
        {isVideo ? (
          <video
            src={firstMedia.url}
            className="h-full w-full object-cover"
            muted
            preload="metadata"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={firstMedia.url}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/StoriesRow.tsx
git commit -m "feat(stories): add horizontal stories row component"
```

---

### Task 4: Full-Screen Story Viewer Component

**Files:**
- Create: `src/app/StoryViewer.tsx`

- [ ] **Step 1: Create the viewer**

```tsx
// src/app/StoryViewer.tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Story } from "./StoriesRow";

const IMAGE_DURATION_MS = 5000;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function StoryViewer({
  stories,
  startIndex,
  onClose,
  onRequestLoadMore,
  hasMore,
}: {
  stories: Story[];
  startIndex: number;
  onClose: () => void;
  onRequestLoadMore?: () => void;
  hasMore?: boolean;
}) {
  const [index, setIndex] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number | null>(null);

  const story = stories[index];
  const firstMedia = story?.media[0];
  const isVideo = firstMedia?.mimeType.startsWith("video/") ?? false;

  const next = useCallback(() => {
    if (index < stories.length - 1) {
      setIndex((i) => i + 1);
      setProgress(0);
    } else if (hasMore && onRequestLoadMore) {
      // Load more stories; if more arrive, stay on current and let parent update
      onRequestLoadMore();
    } else {
      onClose();
    }
  }, [index, stories.length, hasMore, onRequestLoadMore, onClose]);

  const prev = useCallback(() => {
    if (index > 0) {
      setIndex((i) => i - 1);
      setProgress(0);
    }
  }, [index]);

  // Update URL on story change for shareability
  useEffect(() => {
    if (story) {
      window.history.replaceState({}, "", `/s/${story.id}`);
    }
    return () => {
      // When viewer unmounts (close), restore /
      window.history.replaceState({}, "", "/");
    };
  }, [story]);

  // Auto-advance progress for images
  useEffect(() => {
    if (!story || isVideo) return;
    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / IMAGE_DURATION_MS) * 100);
      setProgress(pct);
      if (pct < 100) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        next();
      }
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [story, isVideo, next]);

  // Video progress tracking
  const onVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setProgress((v.currentTime / v.duration) * 100);
  }, []);

  // Keyboard controls
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        prev();
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, onClose]);

  if (!story || !firstMedia?.url) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      {/* Progress bars */}
      <div className="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
        {stories.map((_, i) => (
          <div key={i} className="flex-1 h-[3px] bg-white/30 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-none"
              style={{
                width: i < index ? "100%" : i === index ? `${progress}%` : "0%",
              }}
            />
          </div>
        ))}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-20 text-white p-2 hover:bg-white/10 rounded-full"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>

      {/* Date */}
      <div className="absolute top-4 left-4 z-10 text-white text-sm drop-shadow-lg">
        {formatDate(story.originalDate)}
      </div>

      {/* Media */}
      <div className="w-full h-full flex items-center justify-center">
        {isVideo ? (
          <video
            ref={videoRef}
            key={story.id}
            src={firstMedia.url}
            className="max-w-full max-h-full object-contain"
            autoPlay
            muted
            playsInline
            onEnded={next}
            onTimeUpdate={onVideoTimeUpdate}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={story.id}
            src={firstMedia.url}
            alt=""
            className="max-w-full max-h-full object-contain"
          />
        )}
      </div>

      {/* Tap zones */}
      <button
        onClick={prev}
        className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
        aria-label="Previous story"
      />
      <button
        onClick={next}
        className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
        aria-label="Next story"
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/StoryViewer.tsx
git commit -m "feat(stories): add full-screen story viewer with auto-advance"
```

---

### Task 5: Add Stories Row to Home Page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Update home page to load and render stories row**

Update `src/app/page.tsx` to also fetch stories and pass them to a new `StoriesRow`:

```tsx
import { getPublicFeedPage, getPublicStoriesPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { PublicFeed } from "./PublicFeed";
import { StoriesRow } from "./StoriesRow";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [feed, storiesPage] = await Promise.all([
    getPublicFeedPage(),
    getPublicStoriesPage(),
  ]);

  const postsWithUrls = await Promise.all(
    feed.posts.map(async (p) => ({
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

  const storiesWithUrls = await Promise.all(
    storiesPage.stories.map(async (s) => ({
      id: s.id,
      originalDate: s.originalDate.toISOString(),
      media: await Promise.all(
        s.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  const initialFeed = {
    posts: postsWithUrls,
    nextCursor: feed.nextCursor
      ? { date: feed.nextCursor.date.toISOString(), id: feed.nextCursor.id }
      : null,
  };

  const initialStories = {
    stories: storiesWithUrls,
    nextCursor: storiesPage.nextCursor
      ? {
          date: storiesPage.nextCursor.date.toISOString(),
          id: storiesPage.nextCursor.id,
        }
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
        <StoriesRow initial={initialStories} />
        <PublicFeed initial={initialFeed} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(stories): render stories row on home page"
```

---

### Task 6: Standalone Story Page `/s/[id]`

**Files:**
- Create: `src/app/s/[id]/page.tsx`
- Create: `src/app/s/[id]/SingleStoryViewer.tsx`

- [ ] **Step 1: Create the client wrapper**

```tsx
// src/app/s/[id]/SingleStoryViewer.tsx
"use client";

import { useRouter } from "next/navigation";
import { StoryViewer } from "../../StoryViewer";
import type { Story } from "../../StoriesRow";

export function SingleStoryViewer({ story }: { story: Story }) {
  const router = useRouter();
  return (
    <StoryViewer
      stories={[story]}
      startIndex={0}
      onClose={() => router.push("/")}
    />
  );
}
```

- [ ] **Step 2: Create the server page**

```tsx
// src/app/s/[id]/page.tsx
import { notFound } from "next/navigation";
import { getPublicStory } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { SingleStoryViewer } from "./SingleStoryViewer";

export const dynamic = "force-dynamic";

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const story = await getPublicStory(id);
  if (!story || story.media.length === 0) notFound();

  const mediaWithUrls = await Promise.all(
    story.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
        () => null
      ),
    }))
  );

  const storyForClient = {
    id: story.id,
    originalDate: story.originalDate.toISOString(),
    media: mediaWithUrls,
  };

  return <SingleStoryViewer story={storyForClient} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/s/[id]/page.tsx src/app/s/[id]/SingleStoryViewer.tsx
git commit -m "feat(stories): add standalone /s/[id] story page"
```

---

### Task 7: Hide Scrollbar Utility

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add scrollbar-hide utility**

Append to `src/app/globals.css`:

```css
.scrollbar-hide {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "style(stories): add scrollbar-hide utility for stories row"
```

---

### Task 8: Smoke Test

**Files:** None

- [ ] **Step 1: Restart dev server**

```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run dev &> /tmp/nextdev.log &
```

- [ ] **Step 2: Verify stories row appears**

Open `http://localhost:3000/`. Verify:
- Horizontal row of circular story thumbnails appears above the feed
- Row scrolls horizontally with many stories
- Feed below does NOT include stories (no duplicates)

- [ ] **Step 3: Verify viewer works**

Click a story thumbnail. Verify:
- Full-screen viewer opens
- Progress bar fills over 5 seconds for images, or over video duration
- Tapping right side advances to next story
- Tapping left side goes to previous
- Close (×) returns to feed
- Escape key closes
- URL updates to `/s/<id>` as navigating; closing returns to `/`

- [ ] **Step 4: Verify shareable URL**

Copy a story URL while viewing, open in a new incognito window. Verify:
- Story opens in full-screen viewer immediately
- Close button returns to `/`

- [ ] **Step 5: Type check and tests**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: No new errors; test count ≥ 59 (previously 56 + 3 new isStory tests).

- [ ] **Step 6: Final commit if needed**

```bash
git add -A
git commit -m "fix(stories): adjustments from smoke testing"
```
