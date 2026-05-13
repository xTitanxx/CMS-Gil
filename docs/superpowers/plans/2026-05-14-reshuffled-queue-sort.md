# Reshuffled Queue Sort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a side-by-side "Reshuffled queue" sort option to `/admin/posts` that orders eligible posts using a persistent, media-interleaved, tag-de-clumped shuffle with a 90-day recency floor — without touching the existing `queue_asc` sort.

**Architecture:** A nullable `Post.shufflePosition Float?` column stores the order. A pure function `computeShuffledOrder` runs the algorithm in memory (partition → bucket → proportional interleave → tag-IDF de-clump pass) and writes positions back via sequential awaits. A new `POST /api/planner/reshuffle` endpoint triggers it. `posts-query.ts` recognizes `shuffled_queue_asc` and orders by `shufflePosition` (NULLS LAST). The sort dropdown in `PostFilterUI.tsx` gains the new option plus a "Reshuffle now" button shown when that sort is selected.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + Supabase pgbouncer, TypeScript, Vitest, Tailwind. CLAUDE.md migration workflow (offline SQL, no `prisma migrate dev`).

---

## File Structure

**Create:**
- `src/lib/planner/reshuffle.ts` — algorithm + DB writer.
- `src/lib/planner/reshuffle.test.ts` — unit tests for the pure algorithm.
- `src/app/api/planner/reshuffle/route.ts` — `POST` endpoint.
- `prisma/migrations/<timestamp>_add_post_shuffle_position/migration.sql` — schema migration (offline-generated).

**Modify:**
- `prisma/schema.prisma` — add `shufflePosition Float?` + index on `Post`.
- `src/lib/posts-query.ts` — recognize `shuffled_queue_asc` sort.
- `src/lib/posts-query.test.ts` — cover the new sort branch.
- `src/app/admin/posts/PostFilterUI.tsx` — add sort option + "Reshuffle now" button.

No changes to `src/lib/planner/suggester-filter.ts`, `next-candidate/route.ts`, or `/admin/suggest`.

---

## Task 1: Add shufflePosition column to schema + offline migration

**Files:**
- Modify: `prisma/schema.prisma:127-228` (Post model — add field + index)
- Create: `prisma/migrations/20260514120000_add_post_shuffle_position/migration.sql`

- [ ] **Step 1: Edit Post model in `prisma/schema.prisma`**

Add the field just after `hubPublishCount Int @default(0)` (around line 162):

```prisma
  // Position within the "Reshuffled queue" sort on /admin/posts. Written by
  // computeShuffledOrder() in src/lib/planner/reshuffle.ts. Float so future
  // inserts can slot between two existing positions without renumbering.
  // Null = unshuffled (new posts, NOT_READY→READY transitions); sorts last.
  shufflePosition Float?
```

Add the index alongside the other `@@index` lines (just before the closing `}` of the Post model, near line 227):

```prisma
  @@index([userId, shufflePosition])
```

- [ ] **Step 2: Generate the migration SQL offline**

Run from the worktree root:

```bash
export DATABASE_URL="$POSTGRES_URL_NON_POOLING"
mkdir -p prisma/migrations/20260514120000_add_post_shuffle_position
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  -o prisma/migrations/20260514120000_add_post_shuffle_position/migration.sql
```

Expected output: a migration.sql containing `ALTER TABLE "Post" ADD COLUMN "shufflePosition" DOUBLE PRECISION;` and `CREATE INDEX "Post_userId_shufflePosition_idx" ON "Post"("userId", "shufflePosition");`. If the diff is empty (because the schema/datasource files are identical), the column is already there and you can skip.

If the generated SQL contains anything beyond those two statements (e.g. unrelated drift), delete the migration file and ask before continuing — drift means someone else's WIP is sitting in the schema file.

- [ ] **Step 3: Apply the migration to the live DB**

```bash
psql "$POSTGRES_URL_NON_POOLING" -f prisma/migrations/20260514120000_add_post_shuffle_position/migration.sql
npx prisma migrate resolve --applied 20260514120000_add_post_shuffle_position
```

Expected: psql prints `ALTER TABLE` and `CREATE INDEX`. `migrate resolve` prints `Migration 20260514120000_add_post_shuffle_position marked as applied.`

- [ ] **Step 4: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client (v7.x.x) to ./node_modules/@prisma/client`.

- [ ] **Step 5: Confirm the column exists**

```bash
psql "$POSTGRES_URL_NON_POOLING" -c '\d "Post"' | grep shufflePosition
```

Expected: one line showing `shufflePosition | double precision |`.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260514120000_add_post_shuffle_position/
git commit -m "feat(db): add Post.shufflePosition for reshuffled queue sort"
```

---

## Task 2: Pure algorithm — tag IDF + media bucketing

**Files:**
- Create: `src/lib/planner/reshuffle.ts`
- Test: `src/lib/planner/reshuffle.test.ts`

The pure pieces first (no DB). Three internal helpers we'll test directly: `computeGenericTags`, `dominantMediaKind`, `proportionalInterleave`.

- [ ] **Step 1: Write the failing test for `computeGenericTags`**

Create `src/lib/planner/reshuffle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  computeGenericTags,
  dominantMediaKind,
  proportionalInterleave,
} from "./reshuffle";

describe("computeGenericTags", () => {
  it("flags tags that appear on more than 60% of posts", () => {
    const posts = [
      { id: "a", tags: ["wheelchair", "synagogue"] },
      { id: "b", tags: ["wheelchair", "travel"] },
      { id: "c", tags: ["wheelchair"] },
      { id: "d", tags: ["wheelchair", "synagogue"] },
      { id: "e", tags: ["travel"] },
    ];
    // wheelchair: 4/5 = 80% → generic
    // synagogue: 2/5 = 40% → not generic
    // travel:    2/5 = 40% → not generic
    expect(computeGenericTags(posts, 0.6)).toEqual(new Set(["wheelchair"]));
  });

  it("returns empty set on empty input", () => {
    expect(computeGenericTags([], 0.6)).toEqual(new Set());
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: FAIL — `Cannot find module './reshuffle'`.

- [ ] **Step 3: Create `src/lib/planner/reshuffle.ts` with `computeGenericTags`**

```ts
export interface ReshufflePost {
  id: string;
  tags: string[];
  originalDate: Date;
  mediaMimeTypes: string[];
}

/**
 * Returns the set of tags that appear on strictly more than `threshold`
 * fraction of the input posts. These are excluded from the de-clump comparison
 * because they carry no topic signal (e.g. "wheelchair" on 80% of an archive).
 */
export function computeGenericTags(
  posts: Array<{ tags: string[] }>,
  threshold: number,
): Set<string> {
  if (posts.length === 0) return new Set();
  const counts = new Map<string, number>();
  for (const p of posts) {
    const seen = new Set<string>();
    for (const t of p.tags) {
      if (seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const cutoff = threshold * posts.length;
  const generic = new Set<string>();
  for (const [tag, n] of counts) {
    if (n > cutoff) generic.add(tag);
  }
  return generic;
}
```

- [ ] **Step 4: Verify the test passes**

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: PASS.

- [ ] **Step 5: Add failing tests for `dominantMediaKind`**

Append to `src/lib/planner/reshuffle.test.ts`:

```ts
describe("dominantMediaKind", () => {
  it("returns video when any media is video/*", () => {
    expect(dominantMediaKind(["video/mp4"])).toBe("video");
    expect(dominantMediaKind(["image/jpeg", "video/mp4"])).toBe("video");
  });
  it("returns image when no video but at least one image", () => {
    expect(dominantMediaKind(["image/jpeg"])).toBe("image");
    expect(dominantMediaKind(["image/png", "image/jpeg"])).toBe("image");
  });
  it("returns text when no media at all", () => {
    expect(dominantMediaKind([])).toBe("text");
  });
  it("returns text when media is neither image nor video (rare/unknown)", () => {
    expect(dominantMediaKind(["application/pdf"])).toBe("text");
  });
});
```

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: FAIL — `dominantMediaKind is not exported`.

- [ ] **Step 6: Implement `dominantMediaKind`**

Append to `src/lib/planner/reshuffle.ts`:

```ts
export type MediaKind = "video" | "image" | "text";

export function dominantMediaKind(mimeTypes: string[]): MediaKind {
  if (mimeTypes.some((m) => m.startsWith("video/"))) return "video";
  if (mimeTypes.some((m) => m.startsWith("image/"))) return "image";
  return "text";
}
```

Run the test. Expected: PASS.

- [ ] **Step 7: Add failing tests for `proportionalInterleave`**

Append to `src/lib/planner/reshuffle.test.ts`:

```ts
describe("proportionalInterleave", () => {
  it("spreads a small bucket across the full length", () => {
    // 6 video, 2 image, 0 text → image should land roughly at thirds, not bunched up front
    const out = proportionalInterleave({
      video: ["v1", "v2", "v3", "v4", "v5", "v6"],
      image: ["i1", "i2"],
      text: [],
    });
    expect(out).toHaveLength(8);
    const imageIndices = out.flatMap((id, i) => (id.startsWith("i") ? [i] : []));
    expect(imageIndices).toHaveLength(2);
    // Image positions should be in different thirds of the output, not adjacent
    expect(Math.abs(imageIndices[1] - imageIndices[0])).toBeGreaterThanOrEqual(3);
  });

  it("handles a single non-empty bucket", () => {
    expect(
      proportionalInterleave({ video: ["v1", "v2", "v3"], image: [], text: [] }),
    ).toEqual(["v1", "v2", "v3"]);
  });

  it("handles all empty buckets", () => {
    expect(
      proportionalInterleave({ video: [], image: [], text: [] }),
    ).toEqual([]);
  });

  it("preserves all items exactly once", () => {
    const out = proportionalInterleave({
      video: ["v1", "v2"],
      image: ["i1", "i2"],
      text: ["t1"],
    });
    expect(out.sort()).toEqual(["i1", "i2", "t1", "v1", "v2"]);
  });
});
```

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: FAIL — `proportionalInterleave is not exported`.

- [ ] **Step 8: Implement `proportionalInterleave`**

Append to `src/lib/planner/reshuffle.ts`:

```ts
/**
 * Interleaves up to three buckets so each bucket's items are spread evenly
 * across the output. For each bucket of length N, its i-th item gets target
 * position (i + 0.5) / N. Sorting all (target, kind, item) tuples produces a
 * proportional spread that doesn't clump small buckets at the front.
 *
 * Ties (two buckets wanting the same slot) are broken in declaration order:
 * video → image → text. That ordering is arbitrary; the goal is determinism.
 */
export function proportionalInterleave(buckets: {
  video: string[];
  image: string[];
  text: string[];
}): string[] {
  const order: MediaKind[] = ["video", "image", "text"];
  type Slot = { target: number; kindIdx: number; item: string };
  const slots: Slot[] = [];
  for (let kindIdx = 0; kindIdx < order.length; kindIdx++) {
    const items = buckets[order[kindIdx]];
    const n = items.length;
    if (n === 0) continue;
    for (let i = 0; i < n; i++) {
      slots.push({ target: (i + 0.5) / n, kindIdx, item: items[i] });
    }
  }
  slots.sort((a, b) => a.target - b.target || a.kindIdx - b.kindIdx);
  return slots.map((s) => s.item);
}
```

Run the tests. Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/planner/reshuffle.ts src/lib/planner/reshuffle.test.ts
git commit -m "feat(reshuffle): tag IDF, media bucketing, proportional interleave"
```

---

## Task 3: Pure algorithm — recency partition + de-clump + position assignment

**Files:**
- Modify: `src/lib/planner/reshuffle.ts`
- Test: `src/lib/planner/reshuffle.test.ts`

- [ ] **Step 1: Add failing tests for `computeShuffledOrder` (pure top-level function)**

Append to `src/lib/planner/reshuffle.test.ts`:

```ts
import { computeShuffledOrder } from "./reshuffle";

function postFixture(overrides: Partial<ReshufflePost> & { id: string }): ReshufflePost {
  return {
    tags: [],
    originalDate: new Date("2020-01-01T00:00:00Z"),
    mediaMimeTypes: [],
    ...overrides,
  };
}

describe("computeShuffledOrder", () => {
  const now = new Date("2026-05-14T00:00:00Z");

  it("returns empty array on empty input", () => {
    expect(computeShuffledOrder([], { now })).toEqual([]);
  });

  it("places aged posts strictly before recent (<90d) posts", () => {
    const recent1 = postFixture({
      id: "r1",
      originalDate: new Date("2026-05-01T00:00:00Z"), // 13 days ago — recent
    });
    const recent2 = postFixture({
      id: "r2",
      originalDate: new Date("2026-03-01T00:00:00Z"), // 74 days ago — recent
    });
    const aged1 = postFixture({
      id: "a1",
      originalDate: new Date("2025-01-01T00:00:00Z"),
    });
    const aged2 = postFixture({
      id: "a2",
      originalDate: new Date("2024-06-01T00:00:00Z"),
    });
    const out = computeShuffledOrder([recent1, recent2, aged1, aged2], { now });
    const agedIds = out.filter((id) => id.startsWith("a"));
    const recentIds = out.filter((id) => id.startsWith("r"));
    // Every aged index < every recent index
    const lastAged = out.lastIndexOf(agedIds[agedIds.length - 1]);
    const firstRecent = out.indexOf(recentIds[0]);
    expect(lastAged).toBeLessThan(firstRecent);
  });

  it("produces a permutation (every input exactly once)", () => {
    const posts: ReshufflePost[] = [];
    for (let i = 0; i < 20; i++) {
      posts.push(
        postFixture({
          id: `p${i}`,
          originalDate: new Date(`2024-0${(i % 9) + 1}-01T00:00:00Z`),
          mediaMimeTypes: [i % 3 === 0 ? "video/mp4" : i % 3 === 1 ? "image/jpeg" : "application/pdf"],
        }),
      );
    }
    const out = computeShuffledOrder(posts, { now });
    expect(out).toHaveLength(20);
    expect(new Set(out).size).toBe(20);
  });

  it("does not de-clump on generic tags only (wheelchair scenario)", () => {
    // 6 posts, all share "wheelchair" (will be flagged generic at 100%). No other
    // tag overlap. The aged-only single-kind ordering should be untouched by
    // de-clump, so the output is a valid permutation of all 6.
    const posts = Array.from({ length: 6 }, (_, i) =>
      postFixture({
        id: `p${i}`,
        tags: ["wheelchair"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date(`2024-0${i + 1}-01T00:00:00Z`),
      }),
    );
    const out = computeShuffledOrder(posts, { now });
    expect(out.sort()).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
  });

  it("attempts to break runs of two posts sharing a non-generic tag", () => {
    // 4 aged video posts. p0 and p1 both tagged "synagogue" (rare). p2 and p3 are
    // unrelated. After de-clump, p0 and p1 should not be adjacent if a valid swap
    // exists in the ±3 lookahead.
    const posts = [
      postFixture({
        id: "p0",
        tags: ["synagogue"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-01-01T00:00:00Z"),
      }),
      postFixture({
        id: "p1",
        tags: ["synagogue"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-02-01T00:00:00Z"),
      }),
      postFixture({
        id: "p2",
        tags: ["travel"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-03-01T00:00:00Z"),
      }),
      postFixture({
        id: "p3",
        tags: ["food"],
        mediaMimeTypes: ["video/mp4"],
        originalDate: new Date("2024-04-01T00:00:00Z"),
      }),
    ];
    const out = computeShuffledOrder(posts, { now, seed: 1 });
    const idx0 = out.indexOf("p0");
    const idx1 = out.indexOf("p1");
    expect(Math.abs(idx0 - idx1)).toBeGreaterThan(1);
  });
});
```

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: FAIL — `computeShuffledOrder is not exported`.

- [ ] **Step 2: Implement `computeShuffledOrder`**

Append to `src/lib/planner/reshuffle.ts`:

```ts
const RECENT_FLOOR_DAYS = 90;
const GENERIC_TAG_THRESHOLD = 0.6;
const DECLUMP_LOOKAHEAD = 3;

export interface ComputeShuffledOrderOptions {
  now?: Date;
  /** Optional integer seed for deterministic in-bucket shuffling (tests). */
  seed?: number;
}

/**
 * Deterministic-enough PRNG for in-bucket shuffling. Mulberry32 from Tommy
 * Ettinger — fast, dependency-free, good distribution for small N.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * Runs the full reshuffle pipeline over an eligible-post snapshot:
 *   1. Compute generic tags (IDF cutoff via GENERIC_TAG_THRESHOLD).
 *   2. Partition into aged (< now - 90d) vs recent.
 *   3. Bucket each partition by dominant media kind.
 *   4. Shuffle each bucket (seeded if `seed` provided, else Math.random).
 *   5. Proportionally interleave the buckets within each partition.
 *   6. Walk the list once and attempt to swap adjacent non-generic-tag
 *      collisions with a candidate in the next DECLUMP_LOOKAHEAD positions.
 *   7. Append recent partition after the aged partition.
 *
 * Returns the resulting ID list in order. Position floats are assigned by the
 * caller (writer) — this function is pure and side-effect free.
 */
export function computeShuffledOrder(
  posts: ReshufflePost[],
  opts: ComputeShuffledOrderOptions = {},
): string[] {
  if (posts.length === 0) return [];
  const now = opts.now ?? new Date();
  const rng = opts.seed !== undefined ? mulberry32(opts.seed) : Math.random;

  const generic = computeGenericTags(posts, GENERIC_TAG_THRESHOLD);
  const cutoff = now.getTime() - RECENT_FLOOR_DAYS * 86_400_000;
  const aged: ReshufflePost[] = [];
  const recent: ReshufflePost[] = [];
  for (const p of posts) {
    if (p.originalDate.getTime() < cutoff) aged.push(p);
    else recent.push(p);
  }

  function orderPartition(part: ReshufflePost[]): string[] {
    const buckets: { video: ReshufflePost[]; image: ReshufflePost[]; text: ReshufflePost[] } = {
      video: [],
      image: [],
      text: [],
    };
    for (const p of part) buckets[dominantMediaKind(p.mediaMimeTypes)].push(p);
    shuffleInPlace(buckets.video, rng);
    shuffleInPlace(buckets.image, rng);
    shuffleInPlace(buckets.text, rng);

    const interleaved = proportionalInterleave({
      video: buckets.video.map((p) => p.id),
      image: buckets.image.map((p) => p.id),
      text: buckets.text.map((p) => p.id),
    });

    const byId = new Map(part.map((p) => [p.id, p]));
    return declump(interleaved, byId, generic);
  }

  return [...orderPartition(aged), ...orderPartition(recent)];
}

/**
 * Best-effort single-pass de-clump. For each adjacent pair (i-1, i) sharing a
 * non-generic tag, look at positions i+1..i+DECLUMP_LOOKAHEAD for a swap
 * candidate j whose tags don't collide with i-1 OR i+1 after the swap. First
 * acceptable candidate wins; if none, leave it.
 */
function declump(
  ids: string[],
  byId: Map<string, ReshufflePost>,
  generic: Set<string>,
): string[] {
  const out = [...ids];
  function nonGenericOverlap(a: string, b: string): boolean {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (!pa || !pb) return false;
    for (const t of pa.tags) {
      if (generic.has(t)) continue;
      if (pb.tags.includes(t)) return true;
    }
    return false;
  }
  for (let i = 1; i < out.length; i++) {
    if (!nonGenericOverlap(out[i - 1], out[i])) continue;
    for (let j = i + 1; j <= Math.min(i + DECLUMP_LOOKAHEAD, out.length - 1); j++) {
      const cand = out[j];
      // After swap: position i becomes cand, position j becomes out[i].
      // Check cand vs out[i-1] (must not collide) AND vs out[i+1] (must not collide).
      const beforeCand = out[i - 1];
      const afterCand = j === i + 1 ? out[i] : out[i + 1] ?? null;
      // The displaced item at j+1..: doesn't matter; we only check the immediate
      // neighbors of the new position i. The new neighbors of j (out[i] in the
      // new position) are out[j-1] and out[j+1]; we accept whatever happens there
      // because this is best-effort.
      if (nonGenericOverlap(beforeCand, cand)) continue;
      if (afterCand && nonGenericOverlap(cand, afterCand)) continue;
      [out[i], out[j]] = [out[j], out[i]];
      break;
    }
  }
  return out;
}
```

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: PASS (all tests in this and prior tasks).

- [ ] **Step 3: Commit**

```bash
git add src/lib/planner/reshuffle.ts src/lib/planner/reshuffle.test.ts
git commit -m "feat(reshuffle): recency floor, partition, declump, full pipeline"
```

---

## Task 4: DB writer — `writeShuffledOrderForUser`

**Files:**
- Modify: `src/lib/planner/reshuffle.ts`

The writer fetches the eligible posts, runs the pure algorithm, and writes positions back. Use sequential awaits per CLAUDE.md's pgbouncer note (no `$transaction([...])`).

- [ ] **Step 1: Add the writer function**

Append to `src/lib/planner/reshuffle.ts`:

```ts
import { prisma } from "@/lib/prisma";

const POSITION_STEP = 1000;

/**
 * Reshuffles the user's eligible posts and writes `shufflePosition` for each.
 * Returns the number of posts shuffled.
 *
 * Eligibility mirrors getSuggesterCandidateWhere: readiness NOT IN (NOT_READY,
 * ARCHIVED). Anything else flows through.
 *
 * Writes are sequential (not in a $transaction array) to avoid the pgbouncer
 * P2028 timeout pattern we hit elsewhere. Each row gets a unique float so the
 * sort is stable; spacing of POSITION_STEP leaves room for future inserts.
 */
export async function writeShuffledOrderForUser(userId: string): Promise<number> {
  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { notIn: ["NOT_READY", "ARCHIVED"] },
    },
    select: {
      id: true,
      tags: true,
      originalDate: true,
      media: { select: { mimeType: true } },
    },
  });

  const input: ReshufflePost[] = rows.map((r) => ({
    id: r.id,
    tags: r.tags,
    originalDate: r.originalDate,
    mediaMimeTypes: r.media.map((m) => m.mimeType),
  }));

  const ordered = computeShuffledOrder(input);

  for (let i = 0; i < ordered.length; i++) {
    await prisma.post.update({
      where: { id: ordered[i] },
      data: { shufflePosition: (i + 1) * POSITION_STEP },
    });
  }

  return ordered.length;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors related to `reshuffle.ts`.

- [ ] **Step 3: Run the existing tests to confirm nothing broke**

Run: `npx vitest run src/lib/planner/reshuffle.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/planner/reshuffle.ts
git commit -m "feat(reshuffle): DB writer with sequential awaits"
```

---

## Task 5: API route — `POST /api/planner/reshuffle`

**Files:**
- Create: `src/app/api/planner/reshuffle/route.ts`

- [ ] **Step 1: Create the route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeShuffledOrderForUser } from "@/lib/planner/reshuffle";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const shuffled = await writeShuffledOrderForUser(session.user.id);
  return NextResponse.json({ shuffled, generatedAt: new Date().toISOString() });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Smoke-test against local dev server**

Start `npm run dev` if it isn't running. From another shell:

```bash
curl -s -X POST -b "$(grep -o 'authjs.session-token=[^;]*' ~/.cms-gil-cookies 2>/dev/null || echo '')" http://localhost:3000/api/planner/reshuffle | head -c 500
```

If you don't have a cookie file handy, this step is optional — task 7 will exercise the route via the UI. The important check at this stage is that the route compiles and returns SOMETHING (401 with no session is fine, 500 is not).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/planner/reshuffle/route.ts
git commit -m "feat(api): POST /api/planner/reshuffle endpoint"
```

---

## Task 6: Wire `shuffled_queue_asc` into posts-query.ts

**Files:**
- Modify: `src/lib/posts-query.ts:12-15, 428-433, 466-471, 512-575`
- Modify: `src/lib/posts-query.test.ts`

The list view needs three things to recognize the new sort: the constant, the eligibility-filter wiring (mirror `queue_asc`), and the `orderBy`. We also keep cursor pagination working — for the shuffled sort, the cursor value is just `shufflePosition` (the integer-spaced float).

- [ ] **Step 1: Add failing test**

Append to `src/lib/posts-query.test.ts` (inside the existing `describe("buildPostsQuery", …)`):

```ts
  it("uses shufflePosition ordering and suggester eligibility for shuffled_queue_asc", () => {
    const { where, orderBy } = buildPostsQuery({ sort: "shuffled_queue_asc" }, "user_1");
    // Outer where carries the eligibility filter
    const ands = (where as { AND?: unknown[] }).AND ?? [];
    const hasReadiness = JSON.stringify(ands).includes("NOT_READY");
    expect(hasReadiness).toBe(true);
    // Orders by shufflePosition with NULLS LAST then id
    expect(orderBy[0]).toEqual({ shufflePosition: { sort: "asc", nulls: "last" } });
    expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
  });
```

Run: `npx vitest run src/lib/posts-query.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add the sort constant + recognizer**

Edit `src/lib/posts-query.ts` around line 12-15:

```ts
export const QUEUE_SORT = "queue_asc";
export const SHUFFLED_QUEUE_SORT = "shuffled_queue_asc";

export function isQueueSort(sort: string | undefined): boolean {
  return sort === QUEUE_SORT;
}

export function isShuffledQueueSort(sort: string | undefined): boolean {
  return sort === SHUFFLED_QUEUE_SORT;
}
```

- [ ] **Step 3: Apply the eligibility filter for the new sort**

Edit `src/lib/posts-query.ts` around line 428-433:

```ts
  // Queue sort: layer in the suggester's eligibility filter so the All Posts
  // page mirrors what the one-card suggester would serve. Same logic for the
  // reshuffled test sort.
  if (isQueueSort(filters.sort) || isShuffledQueueSort(filters.sort)) {
    const suggesterWhere = getSuggesterCandidateWhere(userId);
    if (suggesterWhere.readiness) extraAnds.push({ readiness: suggesterWhere.readiness });
  }
```

- [ ] **Step 4: Switch the `orderBy` for the new sort**

Edit `src/lib/posts-query.ts` around line 466-471:

```ts
  const orderBy: Prisma.PostOrderByWithRelationInput[] = isQueueSort(filters.sort)
    ? SUGGESTER_ORDER_BY
    : isShuffledQueueSort(filters.sort)
      ? [
          { shufflePosition: { sort: "asc", nulls: "last" } } as Prisma.PostOrderByWithRelationInput,
          { id: "asc" },
        ]
      : [
          { [field]: dir } as Prisma.PostOrderByWithRelationInput,
          { id: dir },
        ];
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/lib/posts-query.test.ts`
Expected: PASS for the new test. The existing tests should still pass.

- [ ] **Step 6: Handle cursor pagination for the new sort**

`buildCursorClause` and `cursorFromRow` need a `shuffled_queue_asc` branch so infinite scroll works.

Edit `src/lib/posts-query.ts` — modify `buildCursorClause` around line 512:

```ts
export function buildCursorClause(
  sort: string | undefined,
  cursor: PostCursor,
): Prisma.PostWhereInput {
  if (isQueueSort(sort)) {
    const parsed = parseQueueCursorValue(cursor.value);
    if (!parsed) return {};
    const { publishCount, originalDate } = parsed;
    return {
      OR: [
        { publishCount: { gt: publishCount } },
        { publishCount, originalDate: { gt: originalDate } },
        { publishCount, originalDate, id: { gt: cursor.id } },
      ],
    };
  }

  if (isShuffledQueueSort(sort)) {
    // Cursor value is "<float>" or "null" for unshuffled tail.
    if (cursor.value === "null") {
      // We're already in the NULLS LAST tail — just paginate by id.
      return { shufflePosition: null, id: { gt: cursor.id } };
    }
    const pos = Number(cursor.value);
    if (!Number.isFinite(pos)) return {};
    return {
      OR: [
        { shufflePosition: { gt: pos } },
        { shufflePosition: pos, id: { gt: cursor.id } },
        // Cross over into the NULLS LAST tail once shuffled rows are exhausted
        { shufflePosition: null },
      ],
    };
  }

  const { field, dir } = parseSort(sort);
  const op = dir === "desc" ? "lt" : "gt";
  const value = new Date(cursor.value);
  return {
    OR: [
      { [field]: { [op]: value } } as Prisma.PostWhereInput,
      { [field]: value, id: { [op]: cursor.id } } as Prisma.PostWhereInput,
    ],
  };
}
```

Modify `cursorFromRow` around line 551:

```ts
export function cursorFromRow(
  sort: string | undefined,
  row: {
    id: string;
    originalDate: Date;
    createdAt: Date;
    lastPublishedViaHubAt?: Date | null;
    publishCount?: number;
    shufflePosition?: number | null;
  },
): PostCursor {
  if (isQueueSort(sort)) {
    return {
      value: `${row.publishCount ?? 0}|${row.originalDate.toISOString()}`,
      id: row.id,
    };
  }
  if (isShuffledQueueSort(sort)) {
    return {
      value: row.shufflePosition == null ? "null" : String(row.shufflePosition),
      id: row.id,
    };
  }
  const { field } = parseSort(sort);
  const v = row[field];
  return {
    value: (v ?? new Date(0)).toISOString(),
    id: row.id,
  };
}
```

- [ ] **Step 7: Update callsites that select Post columns for cursoring**

Search for places that call `cursorFromRow` to ensure they `select shufflePosition` when the sort is the shuffled one:

```bash
grep -rn "cursorFromRow\b" src --include='*.ts' --include='*.tsx'
```

For each callsite that builds a `select` object, add `shufflePosition: true` if it's missing. Most callsites pass the full Prisma row (with all scalars) and already work — just verify; only add the field where a partial `select` is in play.

- [ ] **Step 8: Run all tests in posts-query**

Run: `npx vitest run src/lib/posts-query.test.ts`
Expected: PASS.

- [ ] **Step 9: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/lib/posts-query.ts src/lib/posts-query.test.ts
git commit -m "feat(posts-query): recognize shuffled_queue_asc sort with NULLS LAST"
```

---

## Task 7: UI — sort dropdown option + "Reshuffle now" button

**Files:**
- Modify: `src/app/admin/posts/PostFilterUI.tsx:134-140, 685-718`

- [ ] **Step 1: Add the option to `SORT_OPTIONS`**

Edit `src/app/admin/posts/PostFilterUI.tsx` around line 134:

```ts
export const SORT_OPTIONS = [
  { value: "originalDate_desc", label: "Post date (newest)" },
  { value: "originalDate_asc", label: "Post date (oldest)" },
  { value: "createdAt_desc", label: "Import date (newest)" },
  { value: "createdAt_asc", label: "Import date (oldest)" },
  { value: "queue_asc", label: "Suggester queue" },
  { value: "shuffled_queue_asc", label: "Reshuffled queue" },
];
```

- [ ] **Step 2: Find the SortMenu component and locate its render site**

```bash
grep -n "SortMenu\|sort: string" src/app/admin/posts/PostFilterUI.tsx | head -20
```

Locate the parent of `SortMenu` (likely the toolbar wrapper) where the sort state and its setter both live. Read 30 lines of context around the call site so the button has the same access to `sort` and a refresh trigger as the dropdown does.

- [ ] **Step 3: Add a `ReshuffleButton` component above `SortMenu` in the same file**

Insert just before the existing `SortMenu` export (around line 660):

```tsx
function ReshuffleButton({
  sort,
  onDone,
}: {
  sort: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (sort !== "shuffled_queue_asc") return null;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/planner/reshuffle", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Reshuffle failed (${res.status})`);
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60"
      title={error ?? "Reshuffle the queue"}
    >
      {busy ? "Reshuffling…" : "Reshuffle now"}
    </button>
  );
}
```

- [ ] **Step 4: Render the button next to `SortMenu`**

Find the call site of `<SortMenu sort={…} setSort={…} />` and wrap it with the button:

```tsx
<div className="flex items-center gap-2">
  <SortMenu sort={sort} setSort={setSort} />
  <ReshuffleButton
    sort={sort}
    onDone={() => {
      // Force the list to refetch from the server. The exact mechanism
      // depends on the parent — if a router refresh hook is in scope use
      // it; otherwise call the existing refetch helper. Default to a
      // hard router refresh.
      router.refresh();
    }}
  />
</div>
```

If `router` isn't already imported in this file, add:

```ts
import { useRouter } from "next/navigation";
```

and at the top of the parent component:

```ts
const router = useRouter();
```

- [ ] **Step 5: Smoke-test in the browser** *(user does this — Eitan handles UI testing)*

Leave a note in the commit message that user-verification is pending. Don't start the dev server.

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint -- src/app/admin/posts/PostFilterUI.tsx`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/admin/posts/PostFilterUI.tsx
git commit -m "feat(posts ui): Reshuffled queue sort option + Reshuffle now button"
```

---

## Task 8: Push + open PR

- [ ] **Step 1: Confirm the worktree branch and push**

```bash
cd /Users/eitan/documents/code-projects/cms-gil-reshuffled-queue
git branch --show-current
# expect: feature/reshuffled-queue-sort
git push -u origin feature/reshuffled-queue-sort
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Reshuffled queue sort (test view)" --body "$(cat <<'EOF'
## Summary
- Adds a "Reshuffled queue" option to the sort dropdown on /admin/posts
- Persists order in a new Post.shufflePosition column (nullable, NULLS LAST)
- Algorithm: media-bucket → proportional interleave → tag-IDF de-clump, with a 90-day recency floor
- POST /api/planner/reshuffle endpoint + "Reshuffle now" button in the toolbar
- Leaves the existing `queue_asc` sort and /admin/suggest untouched — this is a test view to validate ordering before we promote it to drive the suggester

## Test plan
- [ ] Open /admin/posts, pick "Reshuffled queue" from the sort dropdown
- [ ] Click "Reshuffle now"; verify the list reorders and consecutive media types vary
- [ ] Confirm no posts originated in the last 90 days appear at the very top
- [ ] Spot-check a few adjacent pairs for tag overlap (generic tags like "wheelchair" should not count as a collision)
- [ ] Verify `?sort=queue_asc` (Suggester queue) still works unchanged
- [ ] Verify /admin/suggest still works unchanged

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Report the PR URL back to the user**

---

## Self-review

**Spec coverage:**
- Schema field + index → Task 1 ✓
- Algorithm (IDF, partition, bucket, proportional interleave, de-clump) → Tasks 2 + 3 ✓
- API endpoint → Task 5 ✓
- posts-query.ts new sort branch → Task 6 ✓
- UI option + Reshuffle button → Task 7 ✓
- Unit tests for empty input, same-media-only, generic tag ignore, recency partition, position validity → Task 3 ✓
- Float positions for future inserts → Task 4 (`POSITION_STEP = 1000`, multiplied by index+1) ✓
- Sequential awaits (no `$transaction([])`) per pgbouncer note → Task 4 ✓
- Migration via offline diff + psql per CLAUDE.md → Task 1 ✓

**Placeholder scan:** No "TBD", "TODO later", or "appropriate error handling" placeholders. The one "if your callsite has a partial select" instruction in Task 6 Step 7 is a directed search the engineer runs and fixes inline, not a placeholder.

**Type consistency:** `ReshufflePost`, `MediaKind`, `computeShuffledOrder`, `writeShuffledOrderForUser` are used consistently. `shufflePosition` (camelCase, matches the Prisma field) is used throughout. The `SHUFFLED_QUEUE_SORT` constant matches the dropdown value (`"shuffled_queue_asc"`).

No unresolved items.
