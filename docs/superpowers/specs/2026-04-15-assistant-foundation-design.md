# Assistant Foundation — Phase 1 Design

**Date:** 2026-04-15
**Status:** Approved
**Supersedes:** none
**Related:** Phase 2 (assistant + deep-archive Q&A + scheduling) — separate spec, blocked on this.

## Motivation

The post assistant is meant to be the primary tool for deciding what to post. Today it has no visibility into which posts are actually fit to publish, no model of the user's taste, and no sense of whether a post is timeless or tied to a moment. Phase 1 builds the foundational data so that Phase 2 (the assistant UX itself) has something to reason over.

Three foundations, each independently useful:

1. **Readiness** — every post is classified `READY | NOT_READY | ARCHIVED | UNCHECKED` with explicit reasons when not ready. A consumer-grade triage UI fixes or retires the not-ready backlog.
2. **Preference signal** — the user rates posts 1-5★ with structured chip reasons and optional notes. Rated via a mobile-first swipe queue.
3. **Lifecycle + seasonality** — the existing AI tag pipeline is extended to also emit `lifecycle` (evergreen/ephemeral/seasonal) and `season`, with manual override.

## Non-goals

- No assistant behavior changes in Phase 1. The scheduler/chat assistant that consumes these signals is Phase 2.
- No analytics-based signal (reactions/reach) — ratings are the only taste signal in Phase 1.
- No automated repair of broken media beyond surfacing it in triage.

---

## 1. Data model

### Post — new fields

| Field | Type | Default | Notes |
|---|---|---|---|
| `lifecycle` | `Lifecycle` enum | `UNKNOWN` | `EVERGREEN \| EPHEMERAL \| SEASONAL \| UNKNOWN` |
| `season` | `Season?` enum | `null` | `SPRING \| SUMMER \| FALL \| WINTER`; only meaningful when `lifecycle=SEASONAL` |
| `lifecycleOverridden` | `Boolean` | `false` | True if user manually set lifecycle/season; re-analysis skips overridden posts |
| `readiness` | `Readiness` enum | `UNCHECKED` | `READY \| NOT_READY \| ARCHIVED \| UNCHECKED` |
| `notReadyReasons` | `String[]` | `[]` | slugs from the reason vocabulary (below) |
| `readinessCheckedAt` | `DateTime?` | `null` | last time readiness was computed |
| `archivedAt` | `DateTime?` | `null` | set when moved to `ARCHIVED` |

### Post — new relation

- `rating PostRating?` (1:1)

### New model: `PostRating`

```prisma
model PostRating {
  id        String   @id @default(cuid())
  postId    String   @unique
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  stars     Int      // 1..5
  reasons   String[] @default([])  // chip slugs
  note      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([stars])
}
```

Separate table: ratings evolve (re-rate allowed), and keeping Post lean avoids index churn. Indexed on `stars` for scheduler queries in Phase 2.

### Readiness reason vocabulary

- `silent-video` — at least one video media has `hasAudio = false`
- `unchecked-audio` — at least one video media has `hasAudio = null`
- `empty` — body is empty/whitespace AND no media
- `share-only` — body is only a URL, or `share` JSON is set and body is <20 chars of meaningful text
- `broken-media` — at least one media storageKey returns non-2xx from Cloudinary (nightly-cron-only)
- `dont-post` — manually flagged by the user in triage

### Rating chip vocabulary (seed list; extensible)

**Positive:** `great-photo`, `strong-writing`, `signature-voice`, `timeless`, `resonant`
**Negative:** `too-personal`, `not-me-anymore`, `weak-photo`, `overposted-theme`, `low-energy`, `outdated-reference`

Chip set served at `/admin/rate` is context-aware based on stars selected (positive for 4-5★, negative for 1-2★, mixed for 3★). Stored as string slugs so vocabulary is extensible without migration.

---

## 2. Readiness computation

### Triggers

1. On Post create/update — called from API routes that mutate post body or media
2. On Media create/update/delete — a post's readiness depends on its media
3. On-demand bulk via `POST /api/readiness/recompute` (admin-only)
4. Nightly cron `/api/cron/readiness` — full sweep, includes Cloudinary HEAD checks for `broken-media`

### Algorithm (`src/lib/readiness.ts`)

Pure function taking `Post + Media[]`, returning `{ readiness, reasons }`. No DB writes inside the function; caller persists.

```
if post.readiness === ARCHIVED: return { readiness: ARCHIVED, reasons: post.notReadyReasons }

reasons = []

if post.notReadyReasons.includes('dont-post'): reasons.push('dont-post')

bodyTrim = post.body.trim()
if bodyTrim.length === 0 && media.length === 0: reasons.push('empty')

if isShareOnly(post): reasons.push('share-only')
  // share-only = (body matches only a URL) OR (post.share != null && bodyTrim.length < 20)

for m of media:
  if m.mimeType.startsWith('video/'):
    if m.hasAudio === false: reasons.push('silent-video'); break (unique)
    if m.hasAudio === null: reasons.push('unchecked-audio'); break (unique)

// broken-media only appended by nightly cron after HEAD check

return { readiness: reasons.length ? NOT_READY : READY, reasons }
```

### Persistence

Caller writes `{ readiness, notReadyReasons, readinessCheckedAt: now() }` in a single Post update.

### Hot-path integration points

- `src/app/api/posts/route.ts` POST/PATCH — recompute on mutation
- `src/app/api/posts/[id]/route.ts` PATCH/DELETE
- Media mutation endpoints (new `/api/media/[id]` PATCH for replacement)
- Import worker — runs readiness after analyze pass

### Nightly cron `/api/cron/readiness`

- Fetch all posts where `readinessCheckedAt < now - 24h` OR `readiness = UNCHECKED`, in batches of 100
- For each post with media: HEAD each Cloudinary URL, mark `broken-media` on failures
- Recompute readiness + persist
- Protected by `CRON_SECRET`

---

## 3. Triage UI (`/admin/triage`)

### Layout

Mobile-first stacked card feed, desktop is same layout with max-width container. Card shows media thumbnail or silent-waveform icon, body preview (2 lines), reason chips, primary fix affordance, secondary actions.

### Filter pills (top, horizontal-scroll on mobile)

`All · Silent N · Unchecked N · Empty N · Share-only N · Broken N · Don't-post N`

Active filter persisted in URL query (`?bucket=silent-video`).

### Per-reason primary fix in the card

| Reason | Fix affordance |
|---|---|
| `silent-video` | Drag-drop zone / tap-to-pick; replaces video via signed Cloudinary upload; on success recomputes `hasAudio` from response and flips readiness |
| `unchecked-audio` | One-tap "Check audio" button — calls `/api/media/[id]/probe-audio` (wraps existing backfill script logic); row resolves inline |
| `empty` | Inline body textarea; saves via existing post PATCH |
| `share-only` | Inline body textarea to add original commentary |
| `broken-media` | Same drag-drop replace; also "Remove this media" button |
| `dont-post` | One-tap "Unmark" button |

### Secondary actions (always visible)

- **Mark Ready** — force-set `readiness=READY`, keep reasons as audit trail
- **Archive** — set `readiness=ARCHIVED`, `archivedAt=now()`
- **Trash** — existing soft-delete flow
- **Open full editor ↗** — link to `/admin/posts/[id]`

### Gestures (mobile)

- Swipe right → Mark Ready (with 5s undo toast)
- Swipe left → Archive (with 5s undo toast)
- Long-press → Trash (confirm dialog)

### Keyboard shortcuts (desktop)

`J/K` next/prev, `R` ready, `A` archive, `X` trash, `O` open editor.

### Polish

- Optimistic UI with undo toast
- Pull-to-refresh on mobile
- Sidebar badge `Triage · N` updates via `/api/triage/count` (cached 60s server-side)
- Empty state: celebratory illustration when bucket is 0

### API surface

- `GET /api/triage?bucket=<slug>&cursor=<id>` — returns paginated cards
- `GET /api/triage/count` — `{ total, byReason: { ... } }`
- `POST /api/triage/[postId]/mark-ready` — forces `readiness=READY`
- `POST /api/triage/[postId]/archive` — forces `readiness=ARCHIVED`
- `POST /api/media/[id]/probe-audio` — runs audio probe inline
- `PATCH /api/media/[id]` — media replacement (accepts new `storageKey` + Cloudinary metadata)

---

## 4. Rating UX

### Entry points

1. `/admin/rate` — swipe queue (primary)
2. Inline star row on `/admin/posts/[id]`
3. Post cards on `/admin/posts` show current stars as a subtle ★ count

### Queue logic

- Only `READY` posts
- Order: **unrated first** (no `PostRating` row), then **stale** (rating `updatedAt < now - 6mo`), then random fill
- Batch of 20 prefetched client-side, background fetch when queue <5
- `GET /api/ratings/queue?limit=20&cursor=...`

### Card UI (full-screen, stacked)

- Full-bleed hero media (videos autoplay muted, tap to unmute)
- Post body with proper typography, ~10 lines then "read more"
- Tags + original date
- **5-star row** — large tap targets
- **Chips** appear after star tap, vocabulary scoped to rating (positive ≥4★, negative ≤2★, mixed =3★)
- Optional collapsed note input ("add note")
- "Save & next →" primary action

### Gestures

- Swipe left → skip (no rating, post moves to queue end)
- Swipe up → expand to full detail view
- Tap star → locks rating, reveals chips
- Swipe right (after stars tapped) → save & advance

### Progress indicator

Thin top bar: `124 / 987 rated`.

### Desktop shortcuts

`1-5` stars, `Space` save & next, `S` skip, `N` toggle note field.

### API surface

- `POST /api/ratings` — upsert `{ postId, stars, reasons, note? }` (idempotent)
- `GET /api/ratings/queue` — serves the queue
- `GET /api/ratings/stats` — `{ total, rated, byStar }` for the progress bar

---

## 5. AI lifecycle + season extension

### Prompt change in `src/lib/analyze-post.ts`

Return a JSON object instead of a bare tag array:

```json
{
  "tags": ["breathwork", "morning", ...],
  "lifecycle": "EVERGREEN" | "EPHEMERAL" | "SEASONAL",
  "season": "SPRING" | "SUMMER" | "FALL" | "WINTER" | null
}
```

### Classification rules in the prompt

- **EVERGREEN** — reflective, teaching, poetic, personal philosophy; re-postable anytime
- **EPHEMERAL** — tied to a specific dated event, current news, "yesterday/last night" references
- **SEASONAL** — tied to a time of year (holidays, weather, festivals); re-postable when season returns; must also set `season`
- Seasonality also reflected in `tags` (`spring`, `pesach`, `rainy-season`, etc.)

### Parser & persistence

- `parseAnalyzeResponse()` extracts `{ tags, lifecycle, season }`
- `analyzePost()` writes all three in a single Post update
- Skips update of `lifecycle` / `season` if `lifecycleOverridden = true`

### Override UX

- Post detail shows chip: e.g. `🔄 Evergreen` or `🍂 Seasonal · Fall`
- Tap → dropdown to override lifecycle and/or season
- Saving override sets `lifecycleOverridden = true`

### Backfill

- Existing `BulkAnalyzeJob` infrastructure is reused
- Admin button "Re-analyze all posts" kicks off a job that only touches posts where `lifecycleOverridden = false`
- Marginal cost: a few output tokens per post; ~$5-10 for ~1000 posts

---

## Testing strategy

- **Pure functions first**: `computeReadiness()` and `parseAnalyzeResponse()` get full unit test coverage in `src/lib/readiness.test.ts` and extend `src/lib/analyze-post.test.ts`.
- **API routes**: integration tests for `/api/triage/*`, `/api/ratings/*`, `/api/media/[id]` — hit a real dev database (per project convention).
- **UI**: no automated tests (per project convention — user handles UI verification).

## Migration & rollout

1. Prisma migration adds new fields/enums/table
2. Backfill script — computes readiness for all existing posts (no Cloudinary HEAD; relies on existing `hasAudio` data)
3. Backfill script — runs `BulkAnalyzeJob` extension to populate lifecycle/season on existing posts with existing tags
4. Sidebar Triage badge appears; `/admin/triage` and `/admin/rate` routes ship together
5. Nightly readiness cron enabled last (after backfill)

## Open questions (none — all resolved during brainstorm)

## Dependencies for Phase 2

Phase 2 (assistant + scheduler + deep-archive Q&A) will consume:

- `Post.readiness = READY` as a hard filter
- `Post.lifecycle` + `Post.season` for variety and time-of-year relevance
- `PostRating.stars` + `reasons` as the taste signal
- Existing `PublishRecord` history for "posted recently" awareness
- Existing `Post.tags` (now enriched with seasonality) for topic queries
