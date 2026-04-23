# Triage + All Posts unification — design

**Date:** 2026-04-23
**Branch:** `feature/assistant-foundation` (carry-over) or new `feature/triage-allposts-unify`
**Status:** approved, ready for implementation plan

## Goal

Standardize the `/admin/triage` ("Needs fixes") and `/admin/posts` ("All Posts") pages so they share one structural foundation: kind/sub-kind tabs, search (keyword + AI), sort, jump-to-date, filters menu, counts, URL-state round-tripping, and infinite scroll. Each page keeps its own row renderer (triage card vs. compact row) and its own page-specific controls (triage's bucket pills, posts' bulk bar + AI Tag All / Rate Captions / New Post actions).

Also in scope:
- Rename the triage sub-tabs: `Readiness` → `Needs fixes`, `Post improvements` → `AI suggestions`.
- Replace triage's ad-hoc Videos/Images/Stories type tabs with the shared `KindTabs` + `SubKindTabs`.

## Non-goals

- `/admin/posts`' alternate `?view=feed` renderers (`PostsFeed`, `StoriesReel`, `ReelsFeed`) keep working as-is. They can adopt the shared shell later.
- No data-model or triage-reason changes. No new filter facets.
- AI suggestions page (`/admin/triage/improvements`) gets only chrome alignment (title + search/sort/jump-to-date) — body list unchanged.

## Architecture

### The shared shell

New component `src/app/admin/_shared/PostListShell.tsx` owns the chrome:

- Title + `filteredTotal of total` count
- `KindTabs` (Posts / Stories)
- `SubKindTabs` (All / Video / Silent video / Photo / Text / Quoted; story variants)
- Search row: keyword input + AI-search toggle, Sort menu, Jump-to-date menu, Filters menu
- URL-state sync for every control (searchParams round-trip)
- Infinite-scroll sentinel
- Module-level list cache + `useLayoutEffect` scroll restoration (ported byte-for-byte from current `PostsList`)
- Loading / empty / error states

The shell is **headless about rows**. Caller passes:

```ts
<PostListShell
  apiEndpoint="/api/posts" | "/api/triage"
  preset={{ readiness?: "NOT_READY" }}
  renderRow={(post, ctx) => ReactNode}
  beforeList={ReactNode}          // e.g. TriageBuckets strip
  headerActions={ReactNode}       // e.g. Trash / AI Tag All / New Post (posts only)
  bulkBar={ReactNode}             // posts only
  title={string}
  emptyState={ReactNode}
/>
```

### Two consumers

- **`AllPostsView`** (`src/app/admin/posts/AllPostsView.tsx`) — wraps the shell with the compact `PostRow` renderer, bulk-select state/handlers, and posts-specific header actions (Trash, AI Tag All, Rate Captions, New Post). Extracted from today's `PostsList.tsx`.
- **`TriageView`** (`src/app/admin/triage/TriageView.tsx`) — wraps the shell with the `TriageCard` renderer, injects `<TriageBuckets>` as `beforeList`, pins `preset={{ readiness: "NOT_READY" }}`. No bulk bar.

### Shared URL params (both pages)

| Param | Values | Default |
|---|---|---|
| `kind` | `posts` \| `stories` | `posts` |
| `subKind` | `all` \| `video-audio` \| `video-silent` \| `photo` \| `text` \| `quoted` | `all` |
| `search` | string | — |
| `sort` | `originalDate_desc` \| `originalDate_asc` \| `createdAt_desc` \| `createdAt_asc` | `originalDate_desc` |
| `tags` | csv | — |
| `content`, `audio`, `link`, `multiMedia`, `tagged`, `share`, `quality`, `captionQuality`, `enriched` | csv | all |
| `cursor` | opaque | — |

### Triage-only URL param

| Param | Values |
|---|---|
| `bucket` | `silent-video` \| `unchecked-audio` \| `empty` \| `share-only` \| `broken-media` \| `missing-media` \| `dont-post` |

## API changes

### `GET /api/triage`

- Accepts every shared param above and `bucket`.
- Delegates filtering to a new shared helper `buildPostWhere(params)` extracted from `src/lib/posts-query.ts`, with `readiness: "NOT_READY"` merged on top (plus `notReadyReasons: { has: bucket }` when `bucket` is set).
- Response shape aligns with `/api/posts`: `{ posts, total, filteredTotal, kindCounts, subKindCounts, subKindTotals, nextCursor }`. Field `posts` replaces the current `items` (clients updated accordingly).

### `GET /api/triage/count`

- Adds `kind`, `subKind`, `type` query params.
- Counts reflect only the currently viewed slice so bucket-pill numbers match what's actually listed. Unchanged N-count query shape.

### `GET /api/posts`

- No breaking change. `buildPostWhere` is now imported from the shared helper.

## UI changes

### Tab renames (`src/app/admin/triage/TriageTabs.tsx`)

- Label: `Readiness` → `Needs fixes`
- Label: `Post improvements` → `AI suggestions`
- Internal slug: `readiness` → `needs-fixes`, `improvements` → `ai-suggestions`
- URL paths unchanged (`/admin/triage`, `/admin/triage/improvements`).

### Triage bucket pills (`src/app/admin/triage/TriageBuckets.tsx`)

- Extracted from current `TriageFeed`.
- Renders between `SubKindTabs` and the search row via the shell's `beforeList` slot.
- Counts fetched from `/api/triage/count?kind=…&subKind=…` and re-fetched when kind/subKind changes.
- First pill label: `Needs fixes` (replaces bare "All") with total count.

### Triage type-tab consolidation

Triage's existing `Videos / Images / Stories` buttons are **removed**. The shared `KindTabs` + `SubKindTabs` take over:

- Old "Videos" → `kind=posts&subKind=video-audio` (audible videos only). Silent videos now have their own `subKind=video-silent` sub-tab, surfacing what was hidden.
- Old "Images" → `kind=posts&subKind=photo`.
- Old "Stories" → `kind=stories`.

This is a deliberate behavior change: triage loses the "Videos = audible + silent together" single-tap view in favor of the finer-grained filter already shipped on All Posts. Users who want silent triage can use `subKind=video-silent`, which is the common triage path anyway.

### Triage card (`TriageCard.tsx`)

Unchanged. Same swipe gestures, inline fixes (`MediaReplaceDrop`, audio probe, caption editor, dont-post unflag), same secondary action bar, same dismiss toast with undo.

### AI suggestions page (`src/app/admin/triage/improvements/`)

`ImprovementsFeed` wraps its body in the shared shell for header consistency (title + search/sort/jump-to-date). Kind/subKind tabs and filters menu are hidden since suggestions are caption-only. Body renderer (side-by-side current/suggested + Accept/Dismiss) is untouched.

## File plan

### New
- `src/app/admin/_shared/PostListShell.tsx`
- `src/app/admin/_shared/PostListShell.types.ts`
- `src/app/admin/_shared/useListState.ts` (extracts fetch + cache + scroll-restore hooks)
- `src/app/admin/posts/AllPostsView.tsx`
- `src/app/admin/posts/PostRow.tsx`
- `src/app/admin/triage/TriageView.tsx`
- `src/app/admin/triage/TriageBuckets.tsx`

### Modified
- `src/app/admin/posts/page.tsx` — renders `AllPostsView`
- `src/app/admin/triage/page.tsx` — renders `TriageView`
- `src/app/admin/triage/TriageTabs.tsx` — label + slug updates
- `src/app/admin/triage/improvements/ImprovementsFeed.tsx` — wrap in shell chrome
- `src/app/admin/triage/improvements/page.tsx` — tab-slug update
- `src/app/api/triage/route.ts` — shared `buildPostWhere` + response shape alignment
- `src/app/api/triage/count/route.ts` — honor kind/subKind/type
- `src/lib/posts-query.ts` — export `buildPostWhere`

### Deleted (after verification)
- `src/app/admin/posts/PostsList.tsx`
- `src/app/admin/triage/TriageFeed.tsx`

## Risks

- **Scroll restoration.** `PostsList`'s cache + `useLayoutEffect` + `ResizeObserver` logic is nuanced. Port it into the shell verbatim, preserve cache-key shape.
- **Bulk-select** (shift-click range, select-all-across-pages) stays inside `AllPostsView` so the shell remains stateless about selection.
- **Triage response shape change** (`items` → `posts`, added count fields). Only `TriageFeed` consumed `items`, and it's being deleted — no external consumers.
- **Count endpoint load.** `/api/triage/count` runs seven N-count queries per poll. Adding kind/subKind doesn't increase query count, only narrows each. Polling interval unchanged (60s).

## Testing

- **Type-check + existing vitest suite** must pass before commit.
- **Manual verification handoff:** Eitan tests in the browser per CLAUDE.md:
  - All Posts looks + behaves identically (bulk actions, filters, sort, jump-to-date, search, AI search, scroll restore after back-nav).
  - Triage shows kind/subKind tabs + bucket pills + all of the above search/sort/date/filter controls.
  - Swipe actions, inline fixes, undo toast on triage unchanged.
  - AI suggestions page shows title/search/sort/jump-to-date header but body list renders/accepts/dismisses as before.

## Rollout

Single PR, single branch. No feature flag — the swap is visually additive on triage and invisible on All Posts. Revert path = delete the new files + restore the two deleted files from git.
