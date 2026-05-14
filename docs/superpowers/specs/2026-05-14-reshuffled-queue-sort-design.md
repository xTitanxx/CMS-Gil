# Reshuffled queue sort — design

**Date:** 2026-05-14
**Author:** Claude (with Eitan)
**Status:** Draft for review

## Goal

The existing suggester queue (`?sort=queue_asc` on `/admin/posts`, and the source for `/admin/suggest`) orders posts by `publishCount ASC, originalDate ASC` — least-recycled, then oldest. It feels like an unshuffled deck: long runs of the same media type, similar topics next to each other, and very recent posts surfacing too early.

This spec adds a **second**, side-by-side sort — "Reshuffled queue" — that you can preview from the `/admin/posts` sort dropdown to evaluate a smarter ordering before deciding to promote it to the real suggester source.

Constraints the shuffle must satisfy:

1. **Media-type mix** — image / video / text-only should interleave, not clump.
2. **Topic non-clumping** — consecutive posts shouldn't share a non-generic tag. Generic tags like `wheelchair` (on a large share of posts) must not count as "same topic".
3. **Recency floor** — posts whose `originalDate` is within the last 90 days should never be at the front of the queue.
4. **Stability** — once shuffled, the order is fixed in the DB. The list doesn't reshuffle on every page load or every request. The user explicitly tried per-request scoring before and found it "terrible to use in practice."

## Non-goals

- Replacing the existing `?sort=queue_asc` order. This pass leaves it alone.
- Wiring the new shuffle into `/admin/suggest` (the one-by-one card flow). Out of scope until the shuffle quality is validated via the list view.
- Auto-sinking a post to the back of the queue on publish. The existing `publishCount` outer sort already does that for `queue_asc`; we'll redo this guarantee for the shuffle in a follow-up once it's promoted.
- Reshuffling on a schedule, on import, or on readiness change. Manual button only.
- Insert-into-the-middle logic for new posts arriving after a shuffle — they sort to the end via `NULLS LAST` until the next reshuffle.

## Architecture overview

Three small pieces:

- **Schema:** one nullable column `Post.shufflePosition Float?` plus a `(userId, shufflePosition)` index.
- **Algorithm:** a single function `computeShuffledOrder(userId)` in `src/lib/planner/reshuffle.ts` that returns the ordered list of post IDs and writes positions in one transaction.
- **API + UI:**
  - `POST /api/planner/reshuffle` — runs the algorithm for the calling user.
  - New `shuffled_queue_asc` option in the existing posts-list sort dropdown.
  - "Reshuffle now" button shown alongside the dropdown when the new sort is selected.

No changes to `/admin/suggest`, no changes to `getSuggesterCandidateWhere` / `SUGGESTER_ORDER_BY`, no changes to `next-candidate`.

## Detailed design

### Schema

```prisma
model Post {
  // ... existing fields
  shufflePosition Float?

  @@index([userId, shufflePosition])
}
```

`Float` (not `Int`) so future inserts between two existing positions are possible without renumbering — write `(a + b) / 2`. Nullable; new posts and posts whose readiness flipped after the last reshuffle stay null and fall to the end via `NULLS LAST`.

Migration: a single `ADD COLUMN` + `CREATE INDEX`. Generated offline (Supabase pooler) per CLAUDE.md's Prisma gotcha, applied with `psql`, then `prisma migrate resolve --applied`.

### Algorithm — `computeShuffledOrder(userId)`

Pure function over a single eligible-posts query. Eligibility mirrors `getSuggesterCandidateWhere`:

```ts
{ userId, readiness: { notIn: ["NOT_READY", "ARCHIVED"] } }
```

Inputs needed per post: `id`, `tags`, `originalDate`, `media.mimeType`.

**Steps:**

1. **Compute tag IDF** over the eligible set: `idf(t) = log(N / postsWithTag(t))`. Any tag whose `postsWithTag / N > 0.6` is flagged **generic** and excluded from the de-clump comparison. Single in-memory pass.
2. **Recency partition:** split into `aged` (`originalDate < now − 90d`) and `recent` (`>= now − 90d`).
3. **Media bucketing** (within `aged`): assign each post one dominant kind:
   - `video` if any media is `video/*`
   - else `image` if any media is `image/*`
   - else `text-only`
4. **Shuffle each bucket** with `Math.random()`. (No seed — this is a test sort; the user reshuffles manually if they don't like a result.)
5. **Proportional interleave** of the three buckets. Strict round-robin clumps small buckets at the front (e.g. 2 text-only posts both at positions 3 and 6 across 100). Instead, for each bucket `b` with `N_b` items, assign each of its items a target position `(i + 0.5) * Total / N_b` for `i = 0..N_b−1`. Sort all `(position, bucket, item)` tuples; on ties, prefer the bucket that has had the longest gap since its last placement. This evenly spreads rare types across the full length.
6. **Tag de-clump pass** — walk the interleaved list once. For each position `i ≥ 1`:
   - Compute non-generic tag intersection with position `i − 1`.
   - If non-empty: look ahead up to 3 positions for a swap candidate that, after the swap, would not introduce a new collision with either `i − 1` or `i + 1`. Take the first such candidate. If none found, leave the position alone — it's "best effort, one pass."
7. **Recent partition** runs through the same media-bucket + interleave + de-clump pipeline, then is appended to the end of the aged list.
8. **Position assignment:** spaced floats `1000.0, 2000.0, 3000.0, …`. Wide spacing so any future insertion has room.

The algorithm runs entirely in memory after one read query. Writing positions back is a `prisma.$transaction` of `updateMany` per chunk (or per-row if needed — a few hundred to low thousands of rows on Eitan's archive is fine either way; **avoid `$transaction([])`** per CLAUDE.md's pgbouncer note, use sequential awaits).

### API: `POST /api/planner/reshuffle`

- Auth-gated to admins (`session.user.role === "admin"`).
- Runs `computeShuffledOrder` for the user.
- Returns `{ shuffled: number, generatedAt: string }` — just enough for the UI to show a toast.
- No body parameters. Always operates on **all** eligible posts for the user (confirmed scope).

### UI

In `src/app/admin/posts/PostFilterUI.tsx` (or wherever the sort dropdown lives — see exploration in the plan):

- Add a new option to the sort `<select>`: `label = "Reshuffled queue"`, `value = "shuffled_queue_asc"`.
- When that option is selected, render a "Reshuffle now" button next to the dropdown. Clicking it `POST`s to `/api/planner/reshuffle`, awaits, then refreshes the list (router refresh or refetch — match whatever the file already does).
- On first selection: if the user's posts have `shufflePosition` all-null (cheap exists-check on the server, or just-in-time on the API), auto-trigger the reshuffle so the first view isn't empty/random-feeling.

### posts-query.ts changes

In `getPostListQuery` (or equivalent):

- Recognize the new sort value alongside `queue_asc`.
- For `shuffled_queue_asc`:
  - Apply the same eligibility filter from `getSuggesterCandidateWhere` (so the list mirrors what a future suggester would draw from).
  - `orderBy: [{ shufflePosition: "asc" }, { id: "asc" }]` with `nulls: "last"` (Prisma supports `{ sort: "asc", nulls: "last" }`).

### Tests

Unit tests for `computeShuffledOrder`:

- Empty input → empty output.
- All same media type → still produces a valid order (no infinite loops).
- Generic tag (≥60% of corpus) is ignored by de-clump.
- Recent partition is never placed before any aged post.
- Position values are strictly increasing.

No e2e — the user evaluates UX directly in the browser.

## Open follow-ups (not in this spec)

- Promote the shuffle to drive `/admin/suggest` once Eitan confirms the order is good. That's a separate spec — it'll also wire the "sink to back on publish" guarantee.
- Decide whether to auto-reshuffle when a `publishCount` tier empties, or when new posts arrive in bulk.
- Insert-position logic for new posts (instead of `NULLS LAST`).
