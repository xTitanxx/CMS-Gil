# Assistant Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add readiness classification, a 1-5★ rating system, and lifecycle/season AI classification to every post — the foundation for the Phase 2 assistant.

**Architecture:** Schema additions on `Post` + new `PostRating` table. Pure-function readiness calculator invoked on post/media mutations and by a nightly cron. Triage UI at `/admin/triage`, rating UI at `/admin/rate`. AI pipeline extended to return structured `{tags, lifecycle, season}`.

**Tech Stack:** Next.js 16 App Router, Prisma 7 / Postgres (Neon), Anthropic SDK (`claude-sonnet-4-6`), Cloudinary, Vitest. TypeScript strict. React 19.

**Spec:** `docs/superpowers/specs/2026-04-15-assistant-foundation-design.md`

---

## Task 1: Prisma migration — enums, Post fields, PostRating

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_assistant_foundation/migration.sql` (generated)

- [ ] **Step 1: Edit schema**

Add above `model Post`:
```prisma
enum Lifecycle {
  UNKNOWN
  EVERGREEN
  EPHEMERAL
  SEASONAL
}

enum Season {
  SPRING
  SUMMER
  FALL
  WINTER
}

enum Readiness {
  UNCHECKED
  READY
  NOT_READY
  ARCHIVED
}
```

Add inside `model Post` (alongside existing fields):
```prisma
  lifecycle           Lifecycle  @default(UNKNOWN)
  season              Season?
  lifecycleOverridden Boolean    @default(false)
  readiness           Readiness  @default(UNCHECKED)
  notReadyReasons     String[]   @default([])
  readinessCheckedAt  DateTime?
  archivedAt          DateTime?

  rating              PostRating?
```

Add indexes inside `model Post` (next to existing indexes):
```prisma
  @@index([readiness])
  @@index([lifecycle])
```

Add new model at bottom:
```prisma
model PostRating {
  id        String   @id @default(cuid())
  postId    String   @unique
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  stars     Int
  reasons   String[] @default([])
  note      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([stars])
}
```

- [ ] **Step 2: Create migration**

Run: `npx prisma migrate dev --name assistant_foundation`
Expected: migration file created, DB updated, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: schema for readiness, rating, lifecycle"
```

---

## Task 2: Readiness pure function + tests

**Files:**
- Create: `src/lib/readiness.ts`
- Create: `src/lib/readiness.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/readiness.test.ts
import { describe, it, expect } from "vitest";
import { computeReadiness } from "./readiness";

const basePost = {
  body: "A reflective post.",
  share: null as unknown,
  readiness: "UNCHECKED" as const,
  notReadyReasons: [] as string[],
};

describe("computeReadiness", () => {
  it("returns READY for a normal post with body", () => {
    expect(computeReadiness(basePost, [])).toEqual({
      readiness: "READY",
      reasons: [],
    });
  });

  it("flags empty when body blank and no media", () => {
    expect(computeReadiness({ ...basePost, body: "   " }, [])).toEqual({
      readiness: "NOT_READY",
      reasons: ["empty"],
    });
  });

  it("does NOT flag empty when body is blank but media exists", () => {
    const r = computeReadiness({ ...basePost, body: "" }, [
      { mimeType: "image/jpeg", hasAudio: null },
    ]);
    expect(r.readiness).toBe("READY");
  });

  it("flags silent-video when any video has hasAudio=false", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: false },
    ]);
    expect(r.reasons).toContain("silent-video");
    expect(r.readiness).toBe("NOT_READY");
  });

  it("flags unchecked-audio when video has hasAudio=null", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: null },
    ]);
    expect(r.reasons).toContain("unchecked-audio");
  });

  it("prefers silent-video over unchecked-audio when both present", () => {
    const r = computeReadiness(basePost, [
      { mimeType: "video/mp4", hasAudio: false },
      { mimeType: "video/mp4", hasAudio: null },
    ]);
    expect(r.reasons).toContain("silent-video");
    expect(r.reasons).not.toContain("unchecked-audio");
  });

  it("flags share-only when share present and body < 20 chars", () => {
    const r = computeReadiness(
      { ...basePost, body: "nice", share: { url: "https://x.com" } },
      []
    );
    expect(r.reasons).toContain("share-only");
  });

  it("flags share-only when body is only a URL", () => {
    const r = computeReadiness(
      { ...basePost, body: "https://example.com/thing" },
      []
    );
    expect(r.reasons).toContain("share-only");
  });

  it("preserves dont-post flag across computation", () => {
    const r = computeReadiness(
      { ...basePost, notReadyReasons: ["dont-post"] },
      []
    );
    expect(r.reasons).toContain("dont-post");
    expect(r.readiness).toBe("NOT_READY");
  });

  it("short-circuits on ARCHIVED", () => {
    const r = computeReadiness(
      { ...basePost, readiness: "ARCHIVED", notReadyReasons: ["silent-video"] },
      []
    );
    expect(r.readiness).toBe("ARCHIVED");
    expect(r.reasons).toEqual(["silent-video"]);
  });
});
```

- [ ] **Step 2: Run tests, confirm fail**

Run: `npx vitest run src/lib/readiness.test.ts`
Expected: fails with "Cannot find module './readiness'".

- [ ] **Step 3: Implement**

```ts
// src/lib/readiness.ts
export type ReadinessState = "UNCHECKED" | "READY" | "NOT_READY" | "ARCHIVED";

export interface PostLike {
  body: string;
  share: unknown;
  readiness: ReadinessState;
  notReadyReasons: string[];
}

export interface MediaLike {
  mimeType: string;
  hasAudio: boolean | null;
}

export interface ReadinessResult {
  readiness: ReadinessState;
  reasons: string[];
}

const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;

function isShareOnly(post: PostLike): boolean {
  const trimmed = post.body.trim();
  if (URL_ONLY.test(trimmed)) return true;
  if (post.share && trimmed.length < 20) return true;
  return false;
}

export function computeReadiness(
  post: PostLike,
  media: MediaLike[]
): ReadinessResult {
  if (post.readiness === "ARCHIVED") {
    return { readiness: "ARCHIVED", reasons: post.notReadyReasons };
  }

  const reasons: string[] = [];

  if (post.notReadyReasons.includes("dont-post")) reasons.push("dont-post");

  const body = post.body.trim();
  if (body.length === 0 && media.length === 0) reasons.push("empty");

  if (isShareOnly(post)) reasons.push("share-only");

  // Video audio — silent wins over unchecked
  const videos = media.filter((m) => m.mimeType.startsWith("video/"));
  if (videos.some((v) => v.hasAudio === false)) {
    reasons.push("silent-video");
  } else if (videos.some((v) => v.hasAudio === null)) {
    reasons.push("unchecked-audio");
  }

  // Preserve broken-media if it was set by cron (we don't recompute it here)
  if (post.notReadyReasons.includes("broken-media")) reasons.push("broken-media");

  return {
    readiness: reasons.length ? "NOT_READY" : "READY",
    reasons,
  };
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `npx vitest run src/lib/readiness.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/readiness.ts src/lib/readiness.test.ts
git commit -m "feat: readiness pure function"
```

---

## Task 3: Readiness persistence helper + hot-path integration

**Files:**
- Create: `src/lib/readiness-service.ts`
- Modify: `src/app/api/posts/route.ts`
- Modify: `src/app/api/posts/[id]/route.ts`

- [ ] **Step 1: Implement service helper**

```ts
// src/lib/readiness-service.ts
import { prisma } from "./prisma";
import { computeReadiness } from "./readiness";

export async function refreshReadiness(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { media: true },
  });
  if (!post) return;

  const { readiness, reasons } = computeReadiness(
    {
      body: post.body,
      share: post.share,
      readiness: post.readiness,
      notReadyReasons: post.notReadyReasons,
    },
    post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
  );

  if (post.readiness === "ARCHIVED") return; // don't touch archived posts

  await prisma.post.update({
    where: { id: postId },
    data: {
      readiness,
      notReadyReasons: reasons,
      readinessCheckedAt: new Date(),
    },
  });
}
```

- [ ] **Step 2: Call from post POST/PATCH/DELETE**

In `src/app/api/posts/route.ts` after a new post is created, and in `src/app/api/posts/[id]/route.ts` after PATCH (body/media change), call `await refreshReadiness(postId)`. Wrap in try/catch so readiness failure never breaks the mutation.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/lib/readiness-service.ts src/app/api/posts
git commit -m "feat: refresh readiness on post mutation"
```

---

## Task 4: Media replacement endpoint + audio probe endpoint

**Files:**
- Create: `src/app/api/media/[id]/route.ts` (PATCH)
- Create: `src/app/api/media/[id]/probe-audio/route.ts` (POST)

- [ ] **Step 1: Implement probe-audio route**

```ts
// src/app/api/media/[id]/probe-audio/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchVideoAudioStatus } from "@/lib/storage";
import { refreshReadiness } from "@/lib/readiness-service";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;

  const media = await prisma.media.findUnique({ where: { id }, include: { post: true } });
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (media.post.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const hasAudio = await fetchVideoAudioStatus(media.storageKey);
  await prisma.media.update({ where: { id }, data: { hasAudio } });
  await refreshReadiness(media.postId);

  return NextResponse.json({ hasAudio });
}
```

- [ ] **Step 2: Implement PATCH /api/media/[id]**

```ts
// src/app/api/media/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { refreshReadiness } from "@/lib/readiness-service";
import { z } from "zod";

const body = z.object({
  storageKey: z.string(),
  mimeType: z.string(),
  width: z.number().int().nullable().optional(),
  height: z.number().int().nullable().optional(),
  sizeBytes: z.number().int().nullable().optional(),
  hasAudio: z.boolean().nullable().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;
  const parsed = body.parse(await req.json());

  const existing = await prisma.media.findUnique({ where: { id }, include: { post: true } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (existing.post.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.media.update({ where: { id }, data: parsed });
  await refreshReadiness(existing.postId);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck, commit**

```bash
npx tsc --noEmit
git add src/app/api/media
git commit -m "feat: media PATCH + audio probe endpoints"
```

---

## Task 5: Backfill readiness for existing posts

**Files:**
- Create: `scripts/backfill-readiness.ts`

- [ ] **Step 1: Write script**

```ts
// scripts/backfill-readiness.ts
import { prisma } from "../src/lib/prisma";
import { computeReadiness } from "../src/lib/readiness";

async function main() {
  const total = await prisma.post.count({ where: { readiness: "UNCHECKED" } });
  console.log(`Posts to check: ${total}`);
  let cursor: string | null = null;
  let processed = 0;
  while (true) {
    const batch = await prisma.post.findMany({
      where: { readiness: "UNCHECKED" },
      include: { media: true },
      take: 200,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });
    if (batch.length === 0) break;
    for (const post of batch) {
      const { readiness, reasons } = computeReadiness(
        { body: post.body, share: post.share, readiness: post.readiness, notReadyReasons: post.notReadyReasons },
        post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
      );
      await prisma.post.update({
        where: { id: post.id },
        data: { readiness, notReadyReasons: reasons, readinessCheckedAt: new Date() },
      });
      processed++;
    }
    cursor = batch[batch.length - 1].id;
    console.log(`  processed=${processed}/${total}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/backfill-readiness.ts`
Expected: all posts classified.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-readiness.ts
git commit -m "feat: backfill script for readiness"
```

---

## Task 6: Nightly readiness cron (with broken-media HEAD check)

**Files:**
- Create: `src/app/api/cron/readiness/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Implement cron**

```ts
// src/app/api/cron/readiness/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { computeReadiness } from "@/lib/readiness";
import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function isBroken(storageKey: string, mimeType: string): Promise<boolean> {
  const publicId = storageKey.replace(/\.[^/.]+$/, "");
  const resourceType = mimeType.startsWith("video/") ? "video" : "image";
  const url = cloudinary.url(publicId, { resource_type: resourceType, type: "upload" });
  try {
    const res = await fetch(url, { method: "HEAD" });
    return !res.ok;
  } catch {
    return true;
  }
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const posts = await prisma.post.findMany({
    where: {
      OR: [{ readinessCheckedAt: null }, { readinessCheckedAt: { lt: since } }],
      NOT: { readiness: "ARCHIVED" },
    },
    include: { media: true },
    take: 200,
  });

  let updated = 0;
  for (const post of posts) {
    const brokenReasons: string[] = [];
    for (const m of post.media) {
      if (await isBroken(m.storageKey, m.mimeType)) {
        brokenReasons.push("broken-media");
        break;
      }
    }
    const carry = post.notReadyReasons.filter((r) => r === "dont-post");
    const notReadyReasons = [...carry, ...brokenReasons];
    const { readiness, reasons } = computeReadiness(
      { body: post.body, share: post.share, readiness: post.readiness, notReadyReasons },
      post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
    );
    await prisma.post.update({
      where: { id: post.id },
      data: { readiness, notReadyReasons: reasons, readinessCheckedAt: new Date() },
    });
    updated++;
  }
  return NextResponse.json({ updated });
}
```

- [ ] **Step 2: Register cron in `vercel.json`**

Add to `"crons"` array:
```json
{ "path": "/api/cron/readiness", "schedule": "0 3 * * *" }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/readiness vercel.json
git commit -m "feat: nightly readiness cron with broken-media check"
```

---

## Task 7: Extend analyzePost for lifecycle + season

**Files:**
- Modify: `src/lib/analyze-post.ts`
- Modify: `src/lib/analyze-post.test.ts`

- [ ] **Step 1: Write failing tests for new parser**

Add to `src/lib/analyze-post.test.ts`:
```ts
import { parseAnalyzeResponse } from "./analyze-post";

describe("parseAnalyzeResponse", () => {
  it("parses full object response", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["beach","sunset"],"lifecycle":"EVERGREEN","season":null}'
    );
    expect(r).toEqual({ tags: ["beach", "sunset"], lifecycle: "EVERGREEN", season: null });
  });

  it("parses seasonal with season set", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["pesach"],"lifecycle":"SEASONAL","season":"SPRING"}'
    );
    expect(r.lifecycle).toBe("SEASONAL");
    expect(r.season).toBe("SPRING");
  });

  it("lowercases tags", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["Beach","SUNSET"],"lifecycle":"EVERGREEN","season":null}'
    );
    expect(r.tags).toEqual(["beach", "sunset"]);
  });

  it("falls back to UNKNOWN for invalid lifecycle", () => {
    const r = parseAnalyzeResponse(
      '{"tags":["x"],"lifecycle":"WEIRD","season":null}'
    );
    expect(r.lifecycle).toBe("UNKNOWN");
  });

  it("returns empty fallback on malformed JSON", () => {
    expect(parseAnalyzeResponse("nope")).toEqual({
      tags: [], lifecycle: "UNKNOWN", season: null,
    });
  });

  it("falls back from legacy bare-array response", () => {
    const r = parseAnalyzeResponse('["beach","sunset"]');
    expect(r.tags).toEqual(["beach", "sunset"]);
    expect(r.lifecycle).toBe("UNKNOWN");
  });
});
```

- [ ] **Step 2: Run tests, expect fail**

Run: `npx vitest run src/lib/analyze-post.test.ts`
Expected: fails — `parseAnalyzeResponse` not exported.

- [ ] **Step 3: Implement parser and update prompt**

Replace `PROMPT` and `parseTagsFromResponse` in `src/lib/analyze-post.ts`. Keep `parseTagsFromResponse` as a thin wrapper for backward compat. Add:

```ts
const PROMPT = `Analyze this social media post and return a JSON object with these fields:
  "tags": array of 10-20 lowercase descriptive tags (subjects, scenes, mood, activities, seasonality like "spring"/"pesach"/"new-year"),
  "lifecycle": one of "EVERGREEN" (reflective/teaching/poetic; re-postable anytime), "EPHEMERAL" (tied to a dated event or current news; do not re-post), "SEASONAL" (tied to a time of year; re-postable when season returns),
  "season": one of "SPRING","SUMMER","FALL","WINTER" (only when lifecycle is SEASONAL; otherwise null).
Return ONLY the JSON object, no prose.`;

export type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
export type Season = "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;

export interface AnalyzeResult {
  tags: string[];
  lifecycle: Lifecycle;
  season: Season;
}

const LIFECYCLES = new Set(["EVERGREEN", "EPHEMERAL", "SEASONAL"]);
const SEASONS = new Set(["SPRING", "SUMMER", "FALL", "WINTER"]);

export function parseAnalyzeResponse(text: string): AnalyzeResult {
  // Try object form first
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase())
        : [];
      const lifecycle = typeof parsed.lifecycle === "string" && LIFECYCLES.has(parsed.lifecycle)
        ? (parsed.lifecycle as Lifecycle) : "UNKNOWN";
      const season = typeof parsed.season === "string" && SEASONS.has(parsed.season)
        ? (parsed.season as Exclude<Season, null>) : null;
      return { tags, lifecycle, season };
    } catch { /* fall through */ }
  }
  // Legacy: bare array
  const tags = parseTagsFromResponse(text);
  return { tags, lifecycle: "UNKNOWN", season: null };
}
```

Update `analyzePost()` to call `parseAnalyzeResponse(rawText)` and persist:
```ts
const result = parseAnalyzeResponse(rawText);
const data: { tags: string[]; lifecycle?: Lifecycle; season?: Season } = { tags: result.tags };
if (!post.lifecycleOverridden) {
  data.lifecycle = result.lifecycle;
  data.season = result.season;
}
await prisma.post.update({ where: { id: postId }, data });
return result.tags;
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npx vitest run src/lib/analyze-post.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analyze-post.ts src/lib/analyze-post.test.ts
git commit -m "feat: analyzePost emits lifecycle + season"
```

---

## Task 8: Lifecycle/season override API + post detail chip

**Files:**
- Create: `src/app/api/posts/[id]/lifecycle/route.ts`
- Modify: `src/app/admin/posts/[id]/PostEditor.tsx` (add chip + dropdown)

- [ ] **Step 1: Implement PATCH route**

```ts
// src/app/api/posts/[id]/lifecycle/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const body = z.object({
  lifecycle: z.enum(["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"]),
  season: z.enum(["SPRING", "SUMMER", "FALL", "WINTER"]).nullable(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;
  const { lifecycle, season } = body.parse(await req.json());

  const post = await prisma.post.findUnique({ where: { id } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await prisma.post.update({
    where: { id },
    data: { lifecycle, season: lifecycle === "SEASONAL" ? season : null, lifecycleOverridden: true },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Add chip + dropdown to PostEditor**

In `src/app/admin/posts/[id]/PostEditor.tsx`, add a small "Lifecycle" section near tags. Chip shows current `post.lifecycle` (emoji: 🔄 evergreen, ⏳ ephemeral, 🍂 seasonal, ❔ unknown). Click opens a menu with the four choices + season sub-select when SEASONAL. On change, `fetch('/api/posts/{id}/lifecycle', { method: 'PATCH', body: JSON.stringify({ lifecycle, season }) })`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/posts/[id]/lifecycle src/app/admin/posts/[id]/PostEditor.tsx
git commit -m "feat: lifecycle override UI + API"
```

---

## Task 9: Triage API routes

**Files:**
- Create: `src/app/api/triage/count/route.ts`
- Create: `src/app/api/triage/route.ts`
- Create: `src/app/api/triage/[postId]/mark-ready/route.ts`
- Create: `src/app/api/triage/[postId]/archive/route.ts`
- Create: `src/app/api/triage/[postId]/dont-post/route.ts`

- [ ] **Step 1: Count endpoint**

```ts
// src/app/api/triage/count/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const REASONS = [
  "silent-video", "unchecked-audio", "empty", "share-only", "broken-media", "dont-post",
];

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const userId = session.user.id;

  const total = await prisma.post.count({ where: { userId, readiness: "NOT_READY" } });
  const byReason: Record<string, number> = {};
  for (const r of REASONS) {
    byReason[r] = await prisma.post.count({
      where: { userId, readiness: "NOT_READY", notReadyReasons: { has: r } },
    });
  }
  return NextResponse.json({ total, byReason });
}
```

- [ ] **Step 2: Feed endpoint**

```ts
// src/app/api/triage/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const cursor = url.searchParams.get("cursor");

  const where = {
    userId: session.user.id,
    readiness: "NOT_READY" as const,
    ...(bucket ? { notReadyReasons: { has: bucket } } : {}),
  };

  const posts = await prisma.post.findMany({
    where,
    include: { media: true, rating: true },
    orderBy: { originalDate: "desc" },
    take: 21,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = posts.length > 20;
  return NextResponse.json({
    items: posts.slice(0, 20),
    nextCursor: hasMore ? posts[19].id : null,
  });
}
```

- [ ] **Step 3: Action endpoints**

Each is a POST that asserts ownership then updates the post. Follow this pattern (mark-ready):

```ts
// src/app/api/triage/[postId]/mark-ready/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { postId } = await params;
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await prisma.post.update({
    where: { id: postId },
    data: { readiness: "READY", readinessCheckedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
```

`archive/route.ts` sets `{ readiness: "ARCHIVED", archivedAt: new Date() }`.
`dont-post/route.ts` body: `{ enabled: boolean }` — adds or removes `"dont-post"` from `notReadyReasons`, then calls `refreshReadiness`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/triage
git commit -m "feat: triage API surface"
```

---

## Task 10: Triage UI page

**Files:**
- Create: `src/app/admin/triage/page.tsx`
- Create: `src/app/admin/triage/TriageFeed.tsx`
- Create: `src/app/admin/triage/TriageCard.tsx`
- Create: `src/app/admin/triage/MediaReplaceDrop.tsx`

- [ ] **Step 1: Page shell**

`page.tsx`: server component that asserts auth and renders `<TriageFeed />`. Pass current user id.

- [ ] **Step 2: `TriageFeed.tsx` (client)**

- Fetches `/api/triage/count` on mount → renders filter pills
- Pill click → sets `?bucket=` in URL, refetches `/api/triage?bucket=`
- Infinite scroll via cursor
- Renders each post as `<TriageCard />`
- Exposes `onAction(postId)` to remove a card from the list optimistically with undo toast

- [ ] **Step 3: `TriageCard.tsx` (client)**

Props: `post` (with media + reasons). Renders:
- Media thumb (first media) — if silent-video, overlay a speaker-off icon
- Body preview (first 2 lines, CSS line-clamp)
- Reason chips (from `post.notReadyReasons`, human-readable labels)
- Primary fix area — switch on primary reason:
  - `silent-video` / `broken-media` → `<MediaReplaceDrop mediaId={...} onDone={onAction} />`
  - `unchecked-audio` → button: POST `/api/media/{id}/probe-audio`
  - `empty` / `share-only` → inline textarea + save button → PATCH `/api/posts/{id}`
  - `dont-post` → "Unmark" button → POST `/api/triage/{postId}/dont-post` with `{ enabled: false }`
- Secondary row: `Mark Ready` / `Archive` / `Trash` / `Open editor ↗`

Swipe handlers via `react-swipeable` (add to deps) or touch events:
- swipeRight → mark-ready
- swipeLeft → archive
- longPress → confirm then trash

- [ ] **Step 4: `MediaReplaceDrop.tsx` (client)**

Dropzone that accepts a video file, uses existing Cloudinary signed-upload flow (copy pattern from `src/app/admin/posts/[id]/PostEditor.tsx`'s upload path), then PATCH `/api/media/{id}` with the new storageKey + metadata + `hasAudio` (from Cloudinary response `video_metadata`/`audio`). Progress indicator. On success, call `onDone()`.

- [ ] **Step 5: Sidebar badge**

Modify `src/app/admin/layout.tsx` (or wherever the admin nav is defined) — add a "Triage" link; a small client component polls `/api/triage/count` every 60s and renders a badge with `total`.

- [ ] **Step 6: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/triage src/app/admin/layout.tsx
git commit -m "feat: triage UI"
```

---

## Task 11: Ratings API routes

**Files:**
- Create: `src/app/api/ratings/route.ts` (POST upsert)
- Create: `src/app/api/ratings/queue/route.ts` (GET)
- Create: `src/app/api/ratings/stats/route.ts` (GET)

- [ ] **Step 1: POST /api/ratings (upsert)**

```ts
// src/app/api/ratings/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const body = z.object({
  postId: z.string(),
  stars: z.number().int().min(1).max(5),
  reasons: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const data = body.parse(await req.json());
  const post = await prisma.post.findUnique({ where: { id: data.postId } });
  if (!post || post.userId !== session.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const rating = await prisma.postRating.upsert({
    where: { postId: data.postId },
    create: { postId: data.postId, stars: data.stars, reasons: data.reasons, note: data.note ?? null },
    update: { stars: data.stars, reasons: data.reasons, note: data.note ?? null },
  });
  return NextResponse.json(rating);
}
```

- [ ] **Step 2: GET /api/ratings/queue**

```ts
// src/app/api/ratings/queue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const userId = session.user.id;

  // Unrated first
  const unrated = await prisma.post.findMany({
    where: { userId, readiness: "READY", rating: null },
    include: { media: true, rating: true },
    take: limit,
    orderBy: { originalDate: "desc" },
  });
  if (unrated.length >= limit) return NextResponse.json({ items: unrated });

  // Stale — rated >6mo ago
  const sixMo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const stale = await prisma.post.findMany({
    where: {
      userId, readiness: "READY",
      rating: { is: { updatedAt: { lt: sixMo } } },
    },
    include: { media: true, rating: true },
    take: limit - unrated.length,
    orderBy: { originalDate: "desc" },
  });

  return NextResponse.json({ items: [...unrated, ...stale] });
}
```

- [ ] **Step 3: GET /api/ratings/stats**

```ts
// src/app/api/ratings/stats/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const userId = session.user.id;

  const total = await prisma.post.count({ where: { userId, readiness: "READY" } });
  const rated = await prisma.postRating.count({ where: { post: { userId } } });
  const byStarRows = await prisma.postRating.groupBy({
    by: ["stars"], where: { post: { userId } }, _count: true,
  });
  const byStar: Record<number, number> = {1:0,2:0,3:0,4:0,5:0};
  for (const r of byStarRows) byStar[r.stars] = r._count;
  return NextResponse.json({ total, rated, byStar });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ratings
git commit -m "feat: ratings API"
```

---

## Task 12: Rating UI — swipe queue + inline stars

**Files:**
- Create: `src/app/admin/rate/page.tsx`
- Create: `src/app/admin/rate/RateQueue.tsx`
- Create: `src/app/admin/rate/RatingCard.tsx`
- Create: `src/components/StarRow.tsx`
- Modify: `src/app/admin/posts/[id]/PostEditor.tsx` (inline stars)

- [ ] **Step 1: `StarRow.tsx` — shared component**

Props: `value: number | null`, `onChange: (v: number) => void`, `size?: "sm"|"lg"`. 5 tappable stars, keyboard `1-5`. No external deps.

- [ ] **Step 2: `RateQueue.tsx` (client)**

- Fetches `/api/ratings/queue?limit=20` on mount, maintains a local queue
- When queue <5, refetches
- Fetches `/api/ratings/stats` for progress bar
- Renders the top item as `<RatingCard post={top} onSave={...} onSkip={...} />`
- Swipe left (skip) pops to end of local queue (session-scoped)
- After save, POST `/api/ratings`, advances queue

- [ ] **Step 3: `RatingCard.tsx`**

Full-bleed media (video autoplays muted), body text, date, tags. `StarRow` large. On star tap, reveal chips — vocabulary by star bucket:

```ts
const POSITIVE = ["great-photo","strong-writing","signature-voice","timeless","resonant"];
const NEGATIVE = ["too-personal","not-me-anymore","weak-photo","overposted-theme","low-energy","outdated-reference"];
function chipsForStars(s: number): string[] {
  if (s >= 4) return POSITIVE;
  if (s <= 2) return NEGATIVE;
  return [...POSITIVE, ...NEGATIVE];
}
```

Chips are toggleable (multi-select). Optional collapsed "Add note" textarea. `Save & next` button fires `onSave({ stars, reasons, note })`.

Keyboard: `1-5` stars, `Space` save, `S` skip, `N` toggle note.

- [ ] **Step 4: Inline stars on PostEditor**

Add `<StarRow value={post.rating?.stars ?? null} onChange={...} />` to `src/app/admin/posts/[id]/PostEditor.tsx` near the top. On change, POST `/api/ratings` with just `{ postId, stars, reasons: post.rating?.reasons ?? [] }`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/rate src/components/StarRow.tsx src/app/admin/posts/[id]/PostEditor.tsx
git commit -m "feat: rating UI — swipe queue + inline stars"
```

---

## Task 13: Show rating ★ on posts list cards

**Files:**
- Modify: `src/app/admin/posts/PostsList.tsx`
- Modify: `src/app/api/posts/route.ts` (include `rating` in list response)

- [ ] **Step 1: Include rating in list query**

In `src/app/api/posts/route.ts` GET path, add `rating: true` to the `include`.

- [ ] **Step 2: Render stars**

In `PostsList.tsx`, where each card is rendered, if `post.rating?.stars` exists show `★ × stars` in a muted color. Position next to the existing date.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/posts/PostsList.tsx src/app/api/posts/route.ts
git commit -m "feat: show ratings on posts list"
```

---

## Task 14: Manual verification + smoke pass

- [ ] **Step 1: Run unit tests + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 2: Report status to user**

Leave UI verification to the user per project convention. Report:
- Migration applied, backfill complete with counts
- Unit tests green, typecheck clean
- Cron registered
- Routes shipped: `/admin/triage`, `/admin/rate`

- [ ] **Step 3: Open PR**

```bash
git push -u origin feature/assistant-foundation
gh pr create --title "feat: assistant foundation (Phase 1)" --body "..."
```
