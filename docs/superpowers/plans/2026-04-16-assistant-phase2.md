# Assistant Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-surface AI assistant at `/admin/assistant` that recommends posts to publish, answers archive questions, and schedules content — grounded in Phase 1's readiness/rating/lifecycle signals.

**Architecture:** Pure deterministic scorer (`recommend.ts`) + two-stage tag+keyword retrieval (`retrieve.ts`) exposed through a tool-using Claude Sonnet streaming chat endpoint (`/api/assistant`). UI is a chat thread with live tool-result cards. One new Prisma table (`DailyBrief`) for a morning cron. No embeddings, no thread persistence, no auto-posting.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Neon Postgres, `@anthropic-ai/sdk` (matches every other AI endpoint in this repo — no AI SDK migration), React 19, date-fns, vitest.

**Spec:** `docs/superpowers/specs/2026-04-16-assistant-phase2-design.md`

---

## File Structure

**Create:**
- `src/lib/assistant/types.ts` — shared types
- `src/lib/assistant/season.ts` — `currentSeason()` date helper
- `src/lib/assistant/season.test.ts`
- `src/lib/assistant/recommend.ts` — pure scorer + DB candidate loader
- `src/lib/assistant/recommend.test.ts`
- `src/lib/assistant/retrieve.ts` — tag-map + SQL search
- `src/lib/assistant/retrieve.test.ts`
- `src/lib/assistant/tools.ts` — tool schemas + handlers
- `src/lib/assistant/tools.test.ts`
- `src/lib/assistant/prompt.ts` — system prompt builder
- `src/app/api/assistant/route.ts` — streaming chat endpoint
- `src/app/api/assistant/brief/route.ts` — GET today's brief
- `src/app/api/cron/daily-brief/route.ts` — morning cron
- `src/app/(auth)/admin/assistant/page.tsx`
- `src/app/(auth)/admin/assistant/_components/Composer.tsx`
- `src/app/(auth)/admin/assistant/_components/ThreadView.tsx`
- `src/app/(auth)/admin/assistant/_components/ContextRail.tsx`
- `src/app/(auth)/admin/assistant/_components/PostCard.tsx`
- `src/app/(auth)/admin/assistant/_components/PlanCard.tsx`

**Modify:**
- `prisma/schema.prisma` — add `DailyBrief` model + `User.dailyBriefs` relation
- `vercel.json` — add `daily-brief` cron
- `src/app/(auth)/admin/layout.tsx` — sidebar link to `/admin/assistant`

**Delete (last task):**
- `src/app/api/chat/planner/route.ts` — subsumed by `/api/assistant`
- planner chat UI components inside `/admin` dashboard (keep the weekly grid)

---

## Task 1: Prisma — add `DailyBrief`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_daily_brief/migration.sql` (via `prisma migrate dev`)

- [ ] **Step 1: Edit schema**

Append to `prisma/schema.prisma` (near `PostRating`, above end of file):

```prisma
model DailyBrief {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  payload   Json
  createdAt DateTime @default(now())

  @@unique([userId, date])
  @@index([userId, date])
}
```

Add to the `User` model's relations list:

```prisma
  dailyBriefs    DailyBrief[]
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name daily_brief`
Expected: migration file created, Prisma client regenerated.

- [ ] **Step 3: Verify generated types**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(assistant): DailyBrief table"
```

---

## Task 2: Shared types

**Files:**
- Create: `src/lib/assistant/types.ts`

- [ ] **Step 1: Write types**

```ts
// src/lib/assistant/types.ts
import type { Lifecycle, PostType, Season } from "@prisma/client";

export type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube";

export interface ScoreBreakdown {
  ratingScore: number;
  lifecycleFit: number;
  freshness: number;
  tagVariety: number;
  kindDiversity: number;
  penaltyReasons: number;
  total: number;
}

export interface Recommendation {
  postId: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[]; // short human-readable strings for UI
}

export interface RecommendOptions {
  userId: string;
  when?: Date;
  platform?: Platform;
  kind?: PostType;
  excludePostIds?: string[];
  limit?: number;
}

export interface RetrieveOptions {
  userId: string;
  query: string;
  limit?: number;
  lifecycle?: Lifecycle;
  season?: Season;
  dateRange?: { from?: Date; to?: Date };
}

export interface RetrieveHit {
  postId: string;
  score: number;
  matchReasons: string[];
  highlightSnippet: string;
}

export interface CandidateRow {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
  lifecycle: Lifecycle;
  season: Season | null;
  postType: PostType;
  publishCount: number;
  stars: number | null;
  ratingReasons: string[];
  lastPublishedAt: Date | null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistant/types.ts
git commit -m "feat(assistant): shared types"
```

---

## Task 3: `currentSeason` helper (TDD)

**Files:**
- Create: `src/lib/assistant/season.ts`
- Test: `src/lib/assistant/season.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/assistant/season.test.ts
import { describe, it, expect } from "vitest";
import { currentSeason, seasonFit } from "./season";

describe("currentSeason", () => {
  it("maps December to WINTER", () => {
    expect(currentSeason(new Date("2026-12-15"))).toBe("WINTER");
  });
  it("maps February to WINTER", () => {
    expect(currentSeason(new Date("2026-02-10"))).toBe("WINTER");
  });
  it("maps April to SPRING", () => {
    expect(currentSeason(new Date("2026-04-16"))).toBe("SPRING");
  });
  it("maps July to SUMMER", () => {
    expect(currentSeason(new Date("2026-07-04"))).toBe("SUMMER");
  });
  it("maps October to FALL", () => {
    expect(currentSeason(new Date("2026-10-20"))).toBe("FALL");
  });
});

describe("seasonFit", () => {
  it("returns 1 when seasons match", () => {
    expect(seasonFit("SPRING", "SPRING")).toBe(1);
  });
  it("returns 0.3 when seasons are adjacent", () => {
    expect(seasonFit("SPRING", "SUMMER")).toBe(0.3);
    expect(seasonFit("SPRING", "WINTER")).toBe(0.3);
  });
  it("returns -1 when seasons are opposite", () => {
    expect(seasonFit("SPRING", "FALL")).toBe(-1);
    expect(seasonFit("SUMMER", "WINTER")).toBe(-1);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/season.test.ts`
Expected: fails (module not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/assistant/season.ts
import type { Season } from "@prisma/client";

export function currentSeason(date: Date): Season {
  const m = date.getMonth(); // 0..11
  if (m === 11 || m <= 1) return "WINTER";
  if (m >= 2 && m <= 4) return "SPRING";
  if (m >= 5 && m <= 7) return "SUMMER";
  return "FALL";
}

const ORDER: Season[] = ["WINTER", "SPRING", "SUMMER", "FALL"];

export function seasonFit(target: Season, postSeason: Season): number {
  if (target === postSeason) return 1;
  const a = ORDER.indexOf(target);
  const b = ORDER.indexOf(postSeason);
  const diff = Math.min(Math.abs(a - b), 4 - Math.abs(a - b));
  if (diff === 1) return 0.3;
  return -1; // diff === 2 (opposite)
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/season.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant
git commit -m "feat(assistant): season helpers"
```

---

## Task 4: Pure scorer (TDD, no DB)

**Files:**
- Create: `src/lib/assistant/recommend.ts`
- Test: `src/lib/assistant/recommend.test.ts`

- [ ] **Step 1: Write failing tests for pure `scorePost`**

```ts
// src/lib/assistant/recommend.test.ts
import { describe, it, expect } from "vitest";
import { scorePost, WEIGHTS } from "./recommend";
import type { CandidateRow } from "./types";

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "p1",
    body: "hello",
    tags: ["breath"],
    originalDate: new Date("2024-01-01"),
    lifecycle: "EVERGREEN",
    season: null,
    postType: "POST",
    publishCount: 0,
    stars: null,
    ratingReasons: [],
    lastPublishedAt: null,
    ...overrides,
  };
}

describe("scorePost", () => {
  const now = new Date("2026-04-16");

  it("gives 5★ posts a large rating boost", () => {
    const r = scorePost(row({ stars: 5 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.ratingScore).toBe(1.0 * WEIGHTS.rating);
  });

  it("penalizes 1★ posts", () => {
    const r = scorePost(row({ stars: 1 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.ratingScore).toBe(-0.4 * WEIGHTS.rating);
  });

  it("treats unrated posts as small positive prior", () => {
    const r = scorePost(row({ stars: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.ratingScore).toBeCloseTo(0.15 * WEIGHTS.rating);
  });

  it("rewards evergreen", () => {
    const r = scorePost(row({ lifecycle: "EVERGREEN" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("penalizes seasonal off-season", () => {
    // April = SPRING; seasonal-FALL post is opposite
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "FALL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-1.0 * WEIGHTS.fitness);
  });

  it("rewards seasonal in-season", () => {
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "SPRING" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("strongly penalizes ephemeral", () => {
    const r = scorePost(row({ lifecycle: "EPHEMERAL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-0.8 * WEIGHTS.fitness);
  });

  it("scales freshness with months since last publish", () => {
    const r = scorePost(
      row({ lastPublishedAt: new Date("2024-04-16") }), // ~24mo
      now,
      { recentTags: [], recentKinds: [], negativeReasonFrequency: new Map() },
    );
    // 1 - exp(-24/24) = 1 - e^-1 ≈ 0.632
    expect(r.breakdown.freshness).toBeCloseTo(0.632 * WEIGHTS.freshness, 2);
  });

  it("gives never-published full freshness", () => {
    const r = scorePost(row({ lastPublishedAt: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.freshness).toBe(1.0 * WEIGHTS.freshness);
  });

  it("penalizes tag overlap with recent publishes", () => {
    const r = scorePost(row({ tags: ["breath", "mornings"] }), now, {
      recentTags: [["breath", "mornings"]], // full jaccard = 1
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.tagVariety).toBe(0 * WEIGHTS.variety);
  });

  it("penalizes kind repetition when last 3 publishes share kind", () => {
    const r = scorePost(row({ postType: "POST" }), now, {
      recentTags: [],
      recentKinds: ["POST", "POST", "POST"],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.kindDiversity).toBe(-1 * WEIGHTS.diversity);
  });

  it("applies negative-reason penalty when rating reasons recur across peers", () => {
    const freq = new Map<string, number>([["too-personal", 3]]);
    const r = scorePost(row({ ratingReasons: ["too-personal"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: freq,
    });
    expect(r.breakdown.penaltyReasons).toBe(0.15);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/recommend.test.ts`
Expected: fails.

- [ ] **Step 3: Implement scorer**

```ts
// src/lib/assistant/recommend.ts
import type { CandidateRow, Recommendation } from "./types";
import { currentSeason, seasonFit } from "./season";

export const WEIGHTS = {
  rating: 1.0,
  fitness: 0.9,
  freshness: 0.6,
  variety: 0.4,
  diversity: 0.3,
} as const;

const STAR_SCORE: Record<number, number> = {
  1: -0.4, 2: -0.1, 3: 0.2, 4: 0.6, 5: 1.0,
};

export interface ScoringContext {
  recentTags: string[][];          // tags of last N publishes (most recent first)
  recentKinds: string[];           // kinds of last 3 publishes
  negativeReasonFrequency: Map<string, number>; // how often each negative reason appears across all ratings
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const A = new Set(a), B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

export function scorePost(
  post: CandidateRow,
  when: Date,
  ctx: ScoringContext,
): Recommendation {
  const ratingScoreRaw = post.stars == null ? 0.15 : STAR_SCORE[post.stars] ?? 0;
  const ratingScore = ratingScoreRaw * WEIGHTS.rating;

  let fitRaw = 0;
  if (post.lifecycle === "EVERGREEN") fitRaw = 1.0;
  else if (post.lifecycle === "EPHEMERAL") fitRaw = -0.8;
  else if (post.lifecycle === "UNKNOWN") fitRaw = 0.2;
  else if (post.lifecycle === "SEASONAL" && post.season) {
    fitRaw = seasonFit(currentSeason(when), post.season);
  }
  const lifecycleFit = fitRaw * WEIGHTS.fitness;

  let freshnessRaw: number;
  if (!post.lastPublishedAt) freshnessRaw = 1.0;
  else {
    const months = (when.getTime() - post.lastPublishedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
    freshnessRaw = 1 - Math.exp(-months / 24);
  }
  const freshness = freshnessRaw * WEIGHTS.freshness;

  const jaccardSum = ctx.recentTags.reduce((s, t) => s + jaccard(post.tags, t), 0);
  const avgJaccard = ctx.recentTags.length ? jaccardSum / ctx.recentTags.length : 0;
  const tagVariety = (1 - avgJaccard) * WEIGHTS.variety - WEIGHTS.variety; // center at 0
  // simpler: normalize so that jaccard=0 → 0, jaccard=1 → -WEIGHTS.variety
  const tagVarietyAdj = -avgJaccard * WEIGHTS.variety;

  const last3SameKind =
    ctx.recentKinds.length >= 3 && ctx.recentKinds.slice(0, 3).every((k) => k === post.postType);
  const kindDiversity = (last3SameKind ? -1 : 0) * WEIGHTS.diversity;

  const penaltyReasons = post.ratingReasons.reduce(
    (s, r) => ((ctx.negativeReasonFrequency.get(r) ?? 0) >= 3 ? s + 0.15 : s),
    0,
  );

  const total = ratingScore + lifecycleFit + freshness + tagVarietyAdj + kindDiversity - penaltyReasons;

  const reasons: string[] = [];
  if (post.stars != null) reasons.push(`${post.stars}★`);
  if (post.lifecycle === "EVERGREEN") reasons.push("evergreen");
  if (post.lifecycle === "SEASONAL" && post.season) {
    const fit = fitRaw;
    reasons.push(fit === 1 ? `in-season (${post.season.toLowerCase()})` : `seasonal (${post.season.toLowerCase()})`);
  }
  if (freshnessRaw > 0.8) reasons.push("rarely reposted");
  if (last3SameKind) reasons.push("breaks kind streak");

  return {
    postId: post.id,
    score: total,
    breakdown: {
      ratingScore,
      lifecycleFit,
      freshness,
      tagVariety: tagVarietyAdj,
      kindDiversity,
      penaltyReasons,
      total,
    },
    reasons,
  };
}
```

Note: the test `tagVariety` expectation is `0 * WEIGHTS.variety` when `avgJaccard = 1`, i.e. `-WEIGHTS.variety`. Update the test or implementation to align. Fix implementation to produce exactly what the test asserts: when `avgJaccard = 1`, test expects `0`. Meaning: `tagVarietyAdj` returned in the breakdown should be `(1 - avgJaccard) * WEIGHTS.variety`, which at jaccard=1 equals 0, and at jaccard=0 equals `WEIGHTS.variety`. That matches the test. Replace the tagVariety implementation with:

```ts
const tagVarietyAdj = (1 - avgJaccard) * WEIGHTS.variety;
```

(remove the earlier `tagVariety` line entirely — it was a thought dump).

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/recommend.test.ts`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant
git commit -m "feat(assistant): pure scorePost function"
```

---

## Task 5: Candidate loader + `recommend()` orchestrator

**Files:**
- Modify: `src/lib/assistant/recommend.ts`
- Modify: `src/lib/assistant/recommend.test.ts`

- [ ] **Step 1: Add failing integration test (uses `vi.mock`)**

Append to `recommend.test.ts`:

```ts
import { vi } from "vitest";
vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: vi.fn() },
    publishRecord: { findMany: vi.fn() },
    postRating: { groupBy: vi.fn() },
  },
}));

import { recommend } from "./recommend";
import { prisma } from "@/lib/prisma";

describe("recommend", () => {
  it("ranks READY posts and excludes given ids", async () => {
    (prisma.post.findMany as any).mockResolvedValue([
      {
        id: "p1", body: "x", tags: ["a"], originalDate: new Date("2024-01-01"),
        lifecycle: "EVERGREEN", season: null, postType: "POST", publishCount: 0,
        rating: { stars: 5, reasons: [] },
        publishes: [],
      },
      {
        id: "p2", body: "y", tags: ["a"], originalDate: new Date("2024-01-01"),
        lifecycle: "EPHEMERAL", season: null, postType: "POST", publishCount: 0,
        rating: null,
        publishes: [],
      },
    ]);
    (prisma.publishRecord.findMany as any).mockResolvedValue([]);
    (prisma.postRating.groupBy as any).mockResolvedValue([]);

    const recs = await recommend({
      userId: "u1",
      when: new Date("2026-04-16"),
      excludePostIds: [],
      limit: 5,
    });

    expect(recs.map((r) => r.postId)).toEqual(["p1", "p2"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/recommend.test.ts`
Expected: `recommend` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/assistant/recommend.ts`:

```ts
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";
import type { CandidateRow, RecommendOptions, Recommendation } from "./types";

const RECENCY_DAYS = 90;
const RECENT_HISTORY_N = 10;

export async function recommend(opts: RecommendOptions): Promise<Recommendation[]> {
  const when = opts.when ?? new Date();
  const cutoff = subDays(when, RECENCY_DAYS);
  const limit = opts.limit ?? 10;

  const [posts, recentPublishes, negativeReasonRows] = await Promise.all([
    prisma.post.findMany({
      where: {
        userId: opts.userId,
        readiness: "READY",
        share: { equals: Prisma.DbNull },
        ...(opts.kind ? { postType: opts.kind } : {}),
        ...(opts.excludePostIds?.length ? { NOT: { id: { in: opts.excludePostIds } } } : {}),
        publishes: {
          none: {
            OR: [
              { status: "PUBLISHED", publishedAt: { gte: cutoff } },
              { status: "PENDING", scheduledAt: { gte: when } },
            ],
          },
        },
      },
      select: {
        id: true, body: true, tags: true, originalDate: true,
        lifecycle: true, season: true, postType: true, publishCount: true,
        rating: { select: { stars: true, reasons: true } },
        publishes: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 1,
          select: { publishedAt: true },
        },
      },
      orderBy: [{ publishCount: "asc" }, { originalDate: "asc" }],
      take: 200,
    }),
    prisma.publishRecord.findMany({
      where: { status: "PUBLISHED", post: { userId: opts.userId } },
      orderBy: { publishedAt: "desc" },
      take: RECENT_HISTORY_N,
      select: { post: { select: { tags: true, postType: true } } },
    }),
    prisma.postRating.groupBy({
      by: ["reasons"],
      where: { post: { userId: opts.userId } },
      _count: true,
    }).catch(() => [] as Array<{ reasons: string[]; _count: number }>),
  ]);

  const rows: CandidateRow[] = posts.map((p) => ({
    id: p.id,
    body: p.body,
    tags: p.tags,
    originalDate: p.originalDate,
    lifecycle: p.lifecycle,
    season: p.season,
    postType: p.postType,
    publishCount: p.publishCount,
    stars: p.rating?.stars ?? null,
    ratingReasons: p.rating?.reasons ?? [],
    lastPublishedAt: p.publishes[0]?.publishedAt ?? null,
  }));

  const recentTags = recentPublishes.map((r) => r.post.tags);
  const recentKinds = recentPublishes.map((r) => r.post.postType);

  const negativeReasonFrequency = new Map<string, number>();
  for (const row of negativeReasonRows) {
    for (const reason of row.reasons) {
      negativeReasonFrequency.set(reason, (negativeReasonFrequency.get(reason) ?? 0) + (row._count ?? 0));
    }
  }

  const scored = rows.map((r) => scorePost(r, when, { recentTags, recentKinds, negativeReasonFrequency }));
  scored.sort((a, b) => b.score - a.score || 0);
  return scored.slice(0, limit);
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/recommend.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant
git commit -m "feat(assistant): recommend() orchestrator"
```

---

## Task 6: Retrieval — tag mapper + SQL (TDD)

**Files:**
- Create: `src/lib/assistant/retrieve.ts`
- Test: `src/lib/assistant/retrieve.test.ts`

- [ ] **Step 1: Write failing tests (pure query-builder bits first)**

```ts
// src/lib/assistant/retrieve.test.ts
import { describe, it, expect } from "vitest";
import { rankHits, extractSnippet } from "./retrieve";

describe("rankHits", () => {
  it("sorts by tag matches > keyword hits", () => {
    const ranked = rankHits(
      [
        { id: "a", body: "foo bar", tags: ["x"], stars: null },
        { id: "b", body: "foo bar baz", tags: ["x", "y"], stars: null },
      ],
      { tags: ["x", "y"], keywords: ["foo"] },
    );
    expect(ranked[0].postId).toBe("b");
  });

  it("adds rating boost", () => {
    const ranked = rankHits(
      [
        { id: "a", body: "foo", tags: ["x"], stars: 5 },
        { id: "b", body: "foo", tags: ["x"], stars: null },
      ],
      { tags: ["x"], keywords: [] },
    );
    expect(ranked[0].postId).toBe("a");
  });
});

describe("extractSnippet", () => {
  it("returns first keyword hit with context", () => {
    const body = "This is a long body about breathwork and mornings and rituals";
    expect(extractSnippet(body, ["breathwork"])).toContain("breathwork");
  });
  it("falls back to first 140 chars when no keywords", () => {
    const body = "x".repeat(300);
    expect(extractSnippet(body, []).length).toBeLessThanOrEqual(143);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/retrieve.test.ts`
Expected: fails.

- [ ] **Step 3: Implement**

```ts
// src/lib/assistant/retrieve.ts
import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { RetrieveHit, RetrieveOptions } from "./types";

const anthropic = new Anthropic();

interface PostSlim {
  id: string;
  body: string;
  tags: string[];
  stars: number | null;
}

interface MappedQuery {
  tags: string[];
  keywords: string[];
}

export async function mapQuery(userId: string, query: string): Promise<MappedQuery> {
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag FROM "Post" WHERE "userId" = ${userId}
  `;
  const available = rows.map((r) => r.tag);
  const prompt = `You map a natural-language search into tags and keywords for a personal post archive.
Available tags: ${available.join(", ") || "(none)"}
Query: "${query}"
Return only JSON: {"tags": string[], "keywords": string[]}. Tags must come from the available list.`;
  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });
  const text = resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { tags: [], keywords: [] };
  try {
    const parsed = JSON.parse(match[0]) as MappedQuery;
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((t) => typeof t === "string") : [],
    };
  } catch {
    return { tags: [], keywords: [] };
  }
}

export function rankHits(posts: PostSlim[], q: MappedQuery): RetrieveHit[] {
  return posts
    .map((p) => {
      const tagMatches = p.tags.filter((t) => q.tags.includes(t)).length;
      const kwHits = q.keywords.reduce(
        (s, k) => s + (p.body.toLowerCase().includes(k.toLowerCase()) ? 1 : 0),
        0,
      );
      const ratingBoost = p.stars ? (p.stars - 3) * 0.1 : 0;
      const score = (tagMatches * 2 + kwHits) / Math.max(1, q.tags.length + q.keywords.length) + ratingBoost;
      const reasons: string[] = [];
      if (tagMatches) reasons.push(`${tagMatches} tag match${tagMatches === 1 ? "" : "es"}`);
      if (kwHits) reasons.push(`${kwHits} keyword hit${kwHits === 1 ? "" : "s"}`);
      if (p.stars) reasons.push(`${p.stars}★`);
      return {
        postId: p.id,
        score,
        matchReasons: reasons,
        highlightSnippet: extractSnippet(p.body, q.keywords),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function extractSnippet(body: string, keywords: string[]): string {
  const clean = body.replace(/\s+/g, " ").trim();
  for (const k of keywords) {
    const i = clean.toLowerCase().indexOf(k.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - 40);
      return (start > 0 ? "…" : "") + clean.slice(start, start + 140) + (start + 140 < clean.length ? "…" : "");
    }
  }
  return clean.slice(0, 140) + (clean.length > 140 ? "…" : "");
}

export async function retrieve(opts: RetrieveOptions): Promise<RetrieveHit[]> {
  const limit = opts.limit ?? 20;
  const mapped = await mapQuery(opts.userId, opts.query);
  if (!mapped.tags.length && !mapped.keywords.length) return [];

  const where: Prisma.PostWhereInput = {
    userId: opts.userId,
    share: { equals: Prisma.DbNull },
    ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
    ...(opts.season ? { season: opts.season } : {}),
    ...(opts.dateRange?.from || opts.dateRange?.to
      ? {
          originalDate: {
            ...(opts.dateRange?.from ? { gte: opts.dateRange.from } : {}),
            ...(opts.dateRange?.to ? { lte: opts.dateRange.to } : {}),
          },
        }
      : {}),
    OR: [
      ...(mapped.tags.length ? [{ tags: { hasSome: mapped.tags } }] : []),
      ...mapped.keywords.map((k) => ({ body: { contains: k, mode: "insensitive" as const } })),
    ],
  };

  const posts = await prisma.post.findMany({
    where,
    select: {
      id: true, body: true, tags: true,
      rating: { select: { stars: true } },
    },
    take: 200,
  });

  const slim: PostSlim[] = posts.map((p) => ({
    id: p.id,
    body: p.body,
    tags: p.tags,
    stars: p.rating?.stars ?? null,
  }));

  return rankHits(slim, mapped).slice(0, limit);
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/retrieve.test.ts`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant
git commit -m "feat(assistant): retrieve() with tag+keyword ranking"
```

---

## Task 7: Tool handlers (TDD, ownership checks)

**Files:**
- Create: `src/lib/assistant/tools.ts`
- Test: `src/lib/assistant/tools.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/assistant/tools.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: vi.fn() },
    publishRecord: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("./recommend", () => ({ recommend: vi.fn() }));
vi.mock("./retrieve", () => ({ retrieve: vi.fn() }));

import { handleTool } from "./tools";
import { prisma } from "@/lib/prisma";
import { recommend } from "./recommend";
import { retrieve } from "./retrieve";

beforeEach(() => { vi.clearAllMocks(); });

describe("handleTool schedule_post", () => {
  it("rejects non-READY posts", async () => {
    (prisma.post.findFirst as any).mockResolvedValue({ id: "p1", readiness: "NOT_READY" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("READY");
  });

  it("rejects if another pending exists within 24h", async () => {
    (prisma.post.findFirst as any).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.findFirst as any).mockResolvedValue({ id: "pr1" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(false);
    expect(out.error).toContain("already scheduled");
  });

  it("creates PublishRecord on happy path", async () => {
    (prisma.post.findFirst as any).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.findFirst as any).mockResolvedValue(null);
    (prisma.publishRecord.create as any).mockResolvedValue({ id: "pr2" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(true);
    expect((prisma.publishRecord.create as any).mock.calls[0][0].data.postId).toBe("p1");
  });
});

describe("handleTool unschedule", () => {
  it("refuses to delete another user's record", async () => {
    (prisma.publishRecord.findFirst as any).mockResolvedValue(null);
    const out = await handleTool("unschedule", { recordId: "pr1" }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});

describe("handleTool recommend_posts / search_archive", () => {
  it("calls recommend with userId", async () => {
    (recommend as any).mockResolvedValue([]);
    await handleTool("recommend_posts", { limit: 3 }, { userId: "u1" });
    expect((recommend as any).mock.calls[0][0].userId).toBe("u1");
  });
  it("calls retrieve with userId", async () => {
    (retrieve as any).mockResolvedValue([]);
    await handleTool("search_archive", { query: "hi" }, { userId: "u1" });
    expect((retrieve as any).mock.calls[0][0].userId).toBe("u1");
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/assistant/tools.ts
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { recommend } from "./recommend";
import { retrieve } from "./retrieve";

export interface ToolContext { userId: string }
export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "recommend_posts",
    description: "Returns ranked posts to publish based on ratings, lifecycle, freshness, and variety.",
    input_schema: {
      type: "object",
      properties: {
        when: { type: "string", description: "ISO date for target publish. Defaults to now." },
        platform: { type: "string", enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"] },
        kind: { type: "string", enum: ["POST", "STORY", "REEL"] },
        limit: { type: "number", description: "Default 10, max 20." },
      },
    },
  },
  {
    name: "search_archive",
    description: "Searches the archive by tag + keyword. Use for 'find a post about X'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        lifecycle: { type: "string", enum: ["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"] },
        season: { type: "string", enum: ["SPRING", "SUMMER", "FALL", "WINTER"] },
      },
      required: ["query"],
    },
  },
  {
    name: "get_post",
    description: "Full post body, media, rating, and publish history for an id.",
    input_schema: {
      type: "object",
      properties: { postId: { type: "string" } },
      required: ["postId"],
    },
  },
  {
    name: "list_scheduled",
    description: "Pending publishes in a date range, grouped by day and platform.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "ISO date inclusive." },
        to:   { type: "string", description: "ISO date exclusive." },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "schedule_post",
    description: "Creates a PENDING PublishRecord. Requires Post.readiness=READY and no existing pending within 24h of target.",
    input_schema: {
      type: "object",
      properties: {
        postId: { type: "string" },
        platform: { type: "string", enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"] },
        scheduledAt: { type: "string" },
        caption: { type: "string" },
      },
      required: ["postId", "platform", "scheduledAt"],
    },
  },
  {
    name: "unschedule",
    description: "Deletes a PENDING PublishRecord by id.",
    input_schema: {
      type: "object",
      properties: { recordId: { type: "string" } },
      required: ["recordId"],
    },
  },
];

export async function handleTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  switch (name) {
    case "recommend_posts": {
      const data = await recommend({
        userId: ctx.userId,
        when: typeof input.when === "string" ? new Date(input.when) : undefined,
        platform: input.platform as never,
        kind: input.kind as never,
        limit: typeof input.limit === "number" ? Math.min(20, input.limit) : undefined,
      });
      return { ok: true, data };
    }
    case "search_archive": {
      const data = await retrieve({
        userId: ctx.userId,
        query: String(input.query ?? ""),
        limit: typeof input.limit === "number" ? Math.min(50, input.limit) : undefined,
        lifecycle: input.lifecycle as never,
        season: input.season as never,
      });
      return { ok: true, data };
    }
    case "get_post": {
      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        include: {
          media: true,
          rating: true,
          publishes: { orderBy: { scheduledAt: "desc" }, take: 10 },
        },
      });
      if (!post) return { ok: false, error: "post not found" };
      return { ok: true, data: post };
    }
    case "list_scheduled": {
      const data = await prisma.publishRecord.findMany({
        where: {
          status: "PENDING",
          post: { userId: ctx.userId },
          scheduledAt: {
            gte: new Date(String(input.from)),
            lt: new Date(String(input.to)),
          },
        },
        orderBy: { scheduledAt: "asc" },
        include: { post: { select: { id: true, body: true, tags: true } } },
      });
      return { ok: true, data };
    }
    case "schedule_post": {
      const post = await prisma.post.findFirst({
        where: { id: String(input.postId), userId: ctx.userId },
        select: { id: true, readiness: true },
      });
      if (!post) return { ok: false, error: "post not found" };
      if (post.readiness !== "READY") return { ok: false, error: "post is not READY" };

      const target = new Date(String(input.scheduledAt));
      const windowStart = new Date(target.getTime() - 24 * 60 * 60 * 1000);
      const windowEnd = new Date(target.getTime() + 24 * 60 * 60 * 1000);
      const clash = await prisma.publishRecord.findFirst({
        where: {
          postId: post.id,
          status: "PENDING",
          scheduledAt: { gte: windowStart, lte: windowEnd },
        },
      });
      if (clash) return { ok: false, error: "post already scheduled within 24h of that time" };

      const record = await prisma.publishRecord.create({
        data: {
          postId: post.id,
          platform: String(input.platform),
          scheduledAt: target,
          status: "PENDING",
          caption: typeof input.caption === "string" ? input.caption : null,
        },
      });
      return { ok: true, data: record };
    }
    case "unschedule": {
      const record = await prisma.publishRecord.findFirst({
        where: {
          id: String(input.recordId),
          status: "PENDING",
          post: { userId: ctx.userId },
        },
      });
      if (!record) return { ok: false, error: "record not found or not owned" };
      await prisma.publishRecord.delete({ where: { id: record.id } });
      return { ok: true, data: { id: record.id } };
    }
    default:
      return { ok: false, error: `unknown tool: ${name}` };
  }
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: all pass.

- [ ] **Step 5: Typecheck against real Prisma schema**

Run: `npx tsc --noEmit`
Fix any mismatch between `PublishRecord` fields used here and the actual schema (check the `caption` field name — if the schema uses a different name like `body` or none at all, drop that field from the create payload; update test to match).

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistant
git commit -m "feat(assistant): tool handlers with ownership checks"
```

---

## Task 8: System-prompt builder

**Files:**
- Create: `src/lib/assistant/prompt.ts`

- [ ] **Step 1: Implement**

```ts
// src/lib/assistant/prompt.ts
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { currentSeason } from "./season";

export async function buildSystemPrompt(userId: string, now: Date): Promise<string> {
  const [readyCount, ratedCount, pendingNext7, totalPosts] = await Promise.all([
    prisma.post.count({ where: { userId, readiness: "READY" } }),
    prisma.postRating.count({ where: { post: { userId } } }),
    prisma.publishRecord.count({
      where: {
        status: "PENDING",
        post: { userId },
        scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * 24 * 3600 * 1000) },
      },
    }),
    prisma.post.count({ where: { userId } }),
  ]);

  return `You are Gil's post assistant. You help him decide what to post, find things in his archive, and schedule work.

Today: ${format(now, "EEEE, yyyy-MM-dd")} (${currentSeason(now).toLowerCase()})
Archive: ${totalPosts} total · ${readyCount} READY · ${ratedCount} rated
Scheduled in next 7 days: ${pendingNext7}

Rules:
- Use tools. Never invent post content, ids, or scheduling state.
- When referencing a post, cite it as [post:<id>] — the UI renders this as a card.
- When proposing to schedule, explicitly show postId, platform, and scheduledAt; do NOT call schedule_post until the user confirms.
- Prefer recommend_posts for "what should I post"; search_archive for "find me".
- Respect readiness: never schedule a non-READY post.
- Keep replies tight. Prose only where it adds value; tool results carry most info.`;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistant/prompt.ts
git commit -m "feat(assistant): system prompt builder"
```

---

## Task 9: `/api/assistant` streaming route

**Files:**
- Create: `src/app/api/assistant/route.ts`

- [ ] **Step 1: Implement**

```ts
// src/app/api/assistant/route.ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { ASSISTANT_TOOLS, handleTool } from "@/lib/assistant/tools";
import { buildSystemPrompt } from "@/lib/assistant/prompt";

export const maxDuration = 60;

const client = new Anthropic();
const MAX_ITERATIONS = 6;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { messages }: { messages: ClientMessage[] } = await req.json();

  const system = await buildSystemPrompt(userId, new Date());
  const encoder = new TextEncoder();

  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const resp = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system,
            tools: ASSISTANT_TOOLS,
            messages: convo,
          });

          for (const block of resp.content) {
            if (block.type === "text") {
              controller.enqueue(encoder.encode(JSON.stringify({ kind: "text", text: block.text }) + "\n"));
            } else if (block.type === "tool_use") {
              controller.enqueue(
                encoder.encode(JSON.stringify({
                  kind: "tool_use", id: block.id, name: block.name, input: block.input,
                }) + "\n"),
              );
            }
          }

          const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;

          convo.push({ role: "assistant", content: resp.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const result = await handleTool(tu.name, tu.input as Record<string, unknown>, { userId });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: !result.ok,
            });
            controller.enqueue(
              encoder.encode(JSON.stringify({
                kind: "tool_result", toolUseId: tu.id, result,
              }) + "\n"),
            );
          }
          convo.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        console.error("/api/assistant error", err);
        controller.enqueue(encoder.encode(JSON.stringify({ kind: "error", message: "Sorry — something broke. Try again." }) + "\n"));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/assistant
git commit -m "feat(assistant): streaming tool-use endpoint"
```

---

## Task 10: Daily brief cron + endpoint

**Files:**
- Create: `src/app/api/cron/daily-brief/route.ts`
- Create: `src/app/api/assistant/brief/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Cron route**

```ts
// src/app/api/cron/daily-brief/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recommend } from "@/lib/assistant/recommend";
import { startOfDay } from "date-fns";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const today = startOfDay(new Date());
  let written = 0;

  for (const u of users) {
    const recs = await recommend({ userId: u.id, when: new Date(), limit: 3 });
    if (recs.length === 0) continue;
    await prisma.dailyBrief.upsert({
      where: { userId_date: { userId: u.id, date: today } },
      update: { payload: recs as unknown as object },
      create: { userId: u.id, date: today, payload: recs as unknown as object },
    });
    written++;
  }

  return NextResponse.json({ ok: true, written });
}
```

- [ ] **Step 2: Brief GET endpoint**

```ts
// src/app/api/assistant/brief/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay } from "date-fns";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const brief = await prisma.dailyBrief.findUnique({
    where: { userId_date: { userId: session.user.id, date: startOfDay(new Date()) } },
  });
  return NextResponse.json({ brief });
}
```

- [ ] **Step 3: Register cron in `vercel.json`**

Open `vercel.json`, add an object to the `crons` array:

```json
{ "path": "/api/cron/daily-brief", "schedule": "0 5 * * *" }
```

(5am UTC ≈ 7am Jerusalem.)

- [ ] **Step 4: Typecheck + test**

Run: `npx tsc --noEmit`
Run: `npm test`
Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/daily-brief src/app/api/assistant/brief vercel.json
git commit -m "feat(assistant): daily-brief cron + endpoint"
```

---

## Task 11: UI — PostCard + PlanCard components

**Files:**
- Create: `src/app/(auth)/admin/assistant/_components/PostCard.tsx`
- Create: `src/app/(auth)/admin/assistant/_components/PlanCard.tsx`

- [ ] **Step 1: PostCard**

```tsx
// PostCard.tsx
"use client";
import Link from "next/link";

export interface PostCardData {
  postId: string;
  body?: string;
  tags?: string[];
  stars?: number | null;
  lifecycle?: string | null;
  thumbUrl?: string | null;
  reasons?: string[];
  score?: number;
}

export function PostCard({ data, onSchedule }: { data: PostCardData; onSchedule?: (postId: string) => void }) {
  return (
    <div className="rounded-lg border p-3 flex gap-3 items-start bg-white">
      {data.thumbUrl ? (
        <img src={data.thumbUrl} alt="" className="w-20 h-20 object-cover rounded" />
      ) : (
        <div className="w-20 h-20 rounded bg-gray-100" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm line-clamp-2">{data.body}</p>
        <div className="flex flex-wrap gap-1 text-xs mt-1 text-gray-500">
          {data.stars ? <span>{"★".repeat(data.stars)}</span> : null}
          {data.lifecycle ? <span>· {data.lifecycle.toLowerCase()}</span> : null}
          {data.reasons?.map((r) => <span key={r}>· {r}</span>)}
        </div>
        <div className="flex gap-2 mt-2">
          <Link href={`/admin/posts/${data.postId}`} className="text-xs underline">Open</Link>
          {onSchedule && (
            <button onClick={() => onSchedule(data.postId)} className="text-xs underline">Schedule…</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: PlanCard (confirm-before-commit)**

```tsx
// PlanCard.tsx
"use client";

export interface PlanProposal {
  postId: string;
  platform: string;
  scheduledAt: string;
  caption?: string;
}

export function PlanCard({
  proposal,
  onConfirm,
  onCancel,
}: {
  proposal: PlanProposal;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-lg border p-3 bg-amber-50">
      <p className="text-sm font-medium">Schedule this?</p>
      <p className="text-xs mt-1">
        Post <code>{proposal.postId}</code> → <b>{proposal.platform}</b> at{" "}
        {new Date(proposal.scheduledAt).toLocaleString()}
      </p>
      {proposal.caption && <p className="text-xs mt-1 italic">"{proposal.caption}"</p>}
      <div className="flex gap-2 mt-2">
        <button onClick={onConfirm} className="text-xs px-2 py-1 bg-black text-white rounded">Confirm</button>
        <button onClick={onCancel} className="text-xs px-2 py-1 border rounded">Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/admin/assistant
git commit -m "feat(assistant): PostCard + PlanCard components"
```

---

## Task 12: UI — ThreadView with NDJSON parser

**Files:**
- Create: `src/app/(auth)/admin/assistant/_components/ThreadView.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useState, useRef } from "react";
import { PostCard } from "./PostCard";
import { PlanCard } from "./PlanCard";

type UiMsg =
  | { role: "user" | "assistant"; kind: "text"; text: string }
  | { role: "assistant"; kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { role: "assistant"; kind: "tool_result"; toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };

export function ThreadView() {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const userMsg: UiMsg = { role: "user", kind: "text", text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setStreaming(true);

    const history = nextMessages
      .filter((m) => m.kind === "text")
      .map((m) => ({ role: m.role, content: (m as { text: string }).text }));

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    if (!res.body) { setStreaming(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.kind === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.kind === "text") {
                return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }];
              }
              return [...prev, { role: "assistant", kind: "text", text: evt.text }];
            });
          } else if (evt.kind === "tool_use") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "tool_use", id: evt.id, name: evt.name, input: evt.input }]);
          } else if (evt.kind === "tool_result") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "tool_result", toolUseId: evt.toolUseId, result: evt.result }]);
          }
        } catch {}
      }
    }
    setStreaming(false);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.map((m, i) => renderMsg(m, i))}
        {streaming && <p className="text-xs text-gray-400">…</p>}
      </div>
      <form
        className="border-t p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = inputRef.current?.value?.trim();
          if (!v) return;
          send(v);
          if (inputRef.current) inputRef.current.value = "";
        }}
      >
        <textarea ref={inputRef} rows={2} className="flex-1 border rounded p-2 text-sm" placeholder="Ask about the archive, or what to post…" />
        <button disabled={streaming} className="px-3 bg-black text-white rounded text-sm">Send</button>
      </form>
    </div>
  );
}

function renderMsg(m: UiMsg, key: number) {
  if (m.kind === "text") {
    return (
      <div key={key} className={m.role === "user" ? "text-right" : ""}>
        <span className={"inline-block px-3 py-2 rounded-lg text-sm " + (m.role === "user" ? "bg-blue-100" : "bg-gray-100")}>
          {m.text}
        </span>
      </div>
    );
  }
  if (m.kind === "tool_use") {
    return (
      <div key={key} className="text-xs text-gray-500">→ {m.name}(…)</div>
    );
  }
  if (m.kind === "tool_result") {
    if (!m.result.ok) return <div key={key} className="text-xs text-red-600">error: {m.result.error}</div>;
    const data = m.result.data as unknown;
    if (Array.isArray(data)) {
      return (
        <div key={key} className="space-y-2">
          {(data as { postId: string; reasons?: string[]; score?: number; matchReasons?: string[] }[]).slice(0, 5).map((r) => (
            <PostCard key={r.postId} data={{ postId: r.postId, reasons: r.reasons ?? r.matchReasons, score: r.score }} />
          ))}
        </div>
      );
    }
    return null;
  }
  return null;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/admin/assistant
git commit -m "feat(assistant): ThreadView with streaming NDJSON"
```

---

## Task 13: UI — ContextRail (today's brief)

**Files:**
- Create: `src/app/(auth)/admin/assistant/_components/ContextRail.tsx`

- [ ] **Step 1: Implement**

```tsx
"use client";
import { useEffect, useState } from "react";
import { PostCard } from "./PostCard";

export function ContextRail() {
  const [brief, setBrief] = useState<{ payload: { postId: string; reasons?: string[] }[] } | null>(null);

  useEffect(() => {
    fetch("/api/assistant/brief").then((r) => r.json()).then((d) => setBrief(d.brief));
  }, []);

  return (
    <aside className="border-r p-3 w-72 hidden lg:block">
      <h2 className="text-sm font-semibold mb-2">Today's brief</h2>
      {!brief && <p className="text-xs text-gray-500">No brief yet — check back in the morning.</p>}
      {brief && (
        <div className="space-y-2">
          {brief.payload.map((p) => <PostCard key={p.postId} data={{ postId: p.postId, reasons: p.reasons }} />)}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(auth\)/admin/assistant
git commit -m "feat(assistant): ContextRail"
```

---

## Task 14: UI — page + sidebar link

**Files:**
- Create: `src/app/(auth)/admin/assistant/page.tsx`
- Modify: `src/app/(auth)/admin/layout.tsx` (or wherever the admin sidebar lives)

- [ ] **Step 1: Page**

```tsx
// src/app/(auth)/admin/assistant/page.tsx
import { ContextRail } from "./_components/ContextRail";
import { ThreadView } from "./_components/ThreadView";

export default function AssistantPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <ContextRail />
      <main className="flex-1 flex flex-col">
        <ThreadView />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Find sidebar file**

Run: `Grep("admin/posts" glob="src/app/**/*.tsx")` to find the sidebar/nav file; inspect it; append a link:

```tsx
<Link href="/admin/assistant">Assistant</Link>
```

Place it above the "Planner" link (the assistant becomes the primary entry point).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/admin
git commit -m "feat(assistant): /admin/assistant route + sidebar link"
```

---

## Task 15: Deprecate `/api/chat/planner` and planner chat UI

**Files:**
- Delete: `src/app/api/chat/planner/route.ts`
- Modify: any frontend component importing that endpoint (search first)

- [ ] **Step 1: Find callers**

Run: `Grep("api/chat/planner", glob="src/**/*.{ts,tsx}")`
Inspect each caller. If a planner-chat UI component exists separately from the grid, replace its link with a link to `/admin/assistant`. The grid editing UI at `/admin/planner` stays.

- [ ] **Step 2: Remove endpoint**

Run: `rm src/app/api/chat/planner/route.ts`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes (or fix surfaced imports).

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(assistant): remove planner chat endpoint (subsumed by /api/assistant)"
```

---

## Task 16: End-to-end smoke test notes (manual, hand off to user)

- [ ] **Step 1: Write smoke checklist to the PR description**

The user will verify manually:

1. Open `/admin/assistant`, confirm rail loads without a brief.
2. Ask "what should I post today?" — expect a text reply + a recommend_posts tool card with 3-5 PostCards.
3. Ask "find me a post about breathwork" — expect search_archive cards.
4. Ask "schedule post <id> to instagram tomorrow at 10am" — expect a PlanCard proposal; confirming it should create a PublishRecord (verify in `/admin/scheduled`).
5. Trigger the cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" https://cms-gil.vercel.app/api/cron/daily-brief` and confirm a row exists in `DailyBrief`.

- [ ] **Step 2: Open PR**

```bash
git push -u origin feature/assistant-foundation
gh pr create --title "feat: assistant Phase 2" --body "Implements docs/superpowers/specs/2026-04-16-assistant-phase2-design.md"
```

---

## Self-review checklist (run after plan is written)

- Spec §1 Surface → Tasks 11-14 ✓
- Spec §2 Recommendation engine → Tasks 3-5 ✓
- Spec §3 Retrieval → Task 6 ✓
- Spec §4 Assistant agent (tools + streaming + system prompt + guardrails) → Tasks 7-9 ✓
- Spec §5 Scheduling flow (PlanCard confirm-before-commit) → Task 11 ✓; cron §Daily brief → Task 10 ✓
- Spec §6 Data model → Task 1 ✓
- Spec §7 File layout → matches
- Spec §8 Testing → pure fns (3,4,5,6,7) + route typecheck; UI manual per project convention ✓
- Spec §9 Rollout order → migration → scorer → retrieval → tools → route → UI → cron → cleanup ✓
- Spec §10 Decisions → no embeddings (retrieve.ts uses tags+keywords only), ephemeral threads (ThreadView holds state in memory), no auto-platform (PlanCard confirm gate), negative-reason penalty 0.15 (scorer test asserts this) ✓

No placeholders found. Types between tasks: `CandidateRow`, `Recommendation`, `RetrieveHit`, `ScoreBreakdown` are defined once in `types.ts` and consistent throughout. Tool names (`recommend_posts`, `search_archive`, `get_post`, `list_scheduled`, `schedule_post`, `unschedule`) match between `ASSISTANT_TOOLS` and `handleTool` switch.
