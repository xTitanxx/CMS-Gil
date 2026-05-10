# Suggester v2 — design

**Date:** 2026-05-10
**Author:** Claude (with Eitan)
**Status:** Draft for review

## Goal

The mobile Suggester (`/admin/suggest`) shipped in commit `56b266f`. It works, but the in-card UX still feels like an admin form rather than a modern decide-fast-on-the-bus app. This spec covers the next pass:

1. Make the One-by-One card a real iOS-tuned swipe deck.
2. Auto-pick the slot — remove the picker.
3. Make caption editing feel inline, with one-tap AI rewrite.
4. Constrain platform choices to what's actually publishable for the media.
5. Easy "change your mind" everywhere (undo on accept, undo on skip, find skipped posts later in Triage).
6. Build a reliable, notification-independent path for the manual Facebook-personal cross-post.
7. Delete `/admin/rate` (the Review-Posts swipe queue), which the Suggester now replaces.

## Non-goals

- Decision-signal-rich card (rating chip, tag pills, "similar post 2 weeks ago" warnings) — explicitly skipped by Eitan; revisit later if the queue starts feeling noisy.
- Per-platform caption preview / length warnings — skipped this pass.
- Snooze / window scheduling — skipped; auto-slot replaces it.
- Test-notification button + delivery log — Eitan will exercise the existing pipeline manually first.
- Android haptics / desktop affordances — iOS PWA is the only target. Don't ship features that require `navigator.vibrate` (no-op on iOS), pointer hover, or right-click.

## Architecture overview

Three loosely-coupled changes, all in the existing `/admin/suggest` and `/admin/m/[postId]` surfaces, plus a Triage reason and a small data addition:

- **Frontend rework** of `OneByOneCard.tsx` and `SuggesterClient.tsx` (swipe gestures, auto-slot, inline caption, platform constraints, undo, manual-FB inbox tile).
- **Frontend rework** of `ManualPostHelper.tsx` (auto-copy on mount, share-as-primary CTA, "I posted it" close-out).
- **Backend** additions: a new readiness reason `"skipped-in-suggester"`, an endpoint for skip→triage routing, an endpoint for "manual posts to do" inbox, an endpoint to mark a `PublishRecord` as manually published, and undo-friendly variants of accept/skip.
- **Cleanup**: delete `/admin/rate` and orphaned ratings-queue endpoints.

## Detailed design

### 1. Swipe-deck One-by-One card

**Gestures (iOS-tuned, no haptics):**

- Drag left → snap to skip when past 35% of card width.
- Drag right → snap to schedule when past 35% of card width.
- Drag up → opens the caption editor in place (textarea grows over the card; tap outside or pull-down to close).
- Below threshold → spring back. Card follows finger with translate-x and a subtle 4°-max rotate during drag.

Implementation: a single hand-rolled drag handler on the card root using pointer events (`onPointerDown/Move/Up`). No external dep — `framer-motion` would be tempting but is overkill for one card. Reuse the existing `useSwipe` hook in `src/hooks/useSwipe.ts` (already used by `RatingCard`) if its API fits; otherwise a 40-line inline handler.

Card stack: render the *next* candidate behind the current one, dimmed and scaled 0.96, so accept/skip reveals it without a spinner. `SuggesterClient` prefetches `nextCandidate` after every successful fetch and stores it in a `nextRef`; on accept/skip, the prefetched one becomes current and a new prefetch fires in the background.

**Auto-slot:**

The day chips and hour buttons in `OneByOneCard.tsx:228-264` go away entirely. Replace with a single read-only line above the action bar:

> `Next free slot: Tue Jun 23 · 9 AM`

Slot is computed by `findNextOpenSlot` (already exists in `src/app/api/planner/next-candidate/route.ts:21`) and returned in the candidate payload. Accept commits to that slot; user has no UI to override.

**Inline caption:**

Tap the caption text → it becomes a textarea in place (no "Edit / Done" toggle). Tapping outside the textarea (or swiping down) commits and reverts to read-only view. The "✨ Rewrite" chip floats top-right of the textarea while editing; tap fires `POST /api/posts/[id]/caption-suggestion` (existing) and replaces the textarea contents on response. Editing the caption is a soft change — no save button. The body is sent with the accept payload.

**Platform constraints:**

`OneByOneCard.tsx:30-36` already lists `PUBLISHABLE_PLATFORMS`. Add a `requiresVideo: boolean` flag for `YOUTUBE` and `TIKTOK`. When the candidate has no video media (`candidate.hasVideo === false`), those chips render greyed-out with `aria-disabled` and click is a no-op + a small toast "Video posts only".

Already correct: `next-candidate/route.ts:142-143` returns `suggestedPlatforms` filtered through `getEligiblePlatforms`, so non-eligible platforms don't pre-select. The card UI just needs to *also* prevent the user from selecting them manually.

**Action bar:**

Two buttons stay: Skip (left, secondary) and Schedule (right, primary, full-width-2x). They mirror the gesture targets so the affordance is obvious for users who haven't discovered swipe yet.

After accept: the card slides off-screen up-right; `SuggesterClient` shows a 5-second snackbar at the bottom:

> ✓ Scheduled Tue · 9 AM — `Undo`

Tap **Undo** within 5s → calls `DELETE /api/planner/slot/[slotId]` (existing or to be exposed; see backend section), restores the candidate, brings the card back. After 5s, snackbar dismisses and the action becomes permanent.

After skip: same pattern, snackbar reads "Skipped — sent to Triage · `Undo`". Undo calls a new endpoint to remove the readiness reason.

### 2. Skip → Triage routing

**Reason:** add `"skipped-in-suggester"` to the readiness reason vocabulary.

**Skip endpoint:** `POST /api/planner/skip` `{ postId }`:

- Adds `"skipped-in-suggester"` to `post.notReadyReasons` (de-duplicated).
- Sets `post.readiness = "NOT_READY"`.
- Does **not** modify any other reasons.
- Returns `{ ok: true }`.

**Undo:** `POST /api/planner/skip/undo` `{ postId }`:

- Removes `"skipped-in-suggester"` from `notReadyReasons`.
- If the array is now empty, recomputes readiness via `computeReadiness` (so the post returns to READY if nothing else flags it).

**Carry through readiness cron:** the daily cron at `src/app/api/cron/readiness/route.ts:60` currently only preserves the `"dont-post"` reason between runs (`carry = post.notReadyReasons.filter((r) => r === "dont-post")`). Extend the carry list to also keep `"skipped-in-suggester"`. Otherwise the cron will silently wipe it within 24h.

**Triage UI:** `TriageCard.tsx:520` already renders `notReadyReasons` as chips. Add a friendly label for `"skipped-in-suggester"` → `"Skipped while swiping in Suggester"` (per Eitan's wording).

**Triage bucket filter:** Triage's `?bucket=` filter already works on raw reason strings (`api/triage/route.ts:83`). No change needed — `?bucket=skipped-in-suggester` will Just Work as a deep-link.

**Triage actions on a skipped post:** the existing Triage card has Keep / Delete / etc. No new actions required — Eitan's stated goal is just "see them later and either fix or delete". The existing buttons suffice.

### 3. Manual Facebook-personal transfer

Two surfaces:

#### 3a. Manual-posts inbox tile on `/admin/suggest`

New menu tile under the One-by-One / Bulk-plan tiles, only rendered when there's at least one manual-FB job pending:

> 📲 **Manual posts to do** (3)
> Tap to cross-post the next one to Facebook personal.

Powered by `GET /api/planner/manual-fb-pending` returning posts that are:

- Scheduled or recently due (e.g. between 30 min ago and 4 hours from now).
- Have `FACEBOOK_PERSONAL` in their `WeeklyPlanSlot.platforms` (or an equivalent flag — see "Open question" below).
- Don't yet have a `PublishRecord` with `platform=FACEBOOK_PERSONAL` and `status=PUBLISHED`.

Tap → navigates to `/admin/m/[postId]` for the soonest pending one.

This makes the flow notification-independent: whether a push fired or the user just opened the app, the "what manual work is queued?" answer is one tap from the menu.

#### 3b. `/admin/m/[postId]` polish

- **Auto-copy on mount.** On first render, fire `handleCopy()` once. Show a green banner "Caption copied — paste in Facebook." The Copy button stays for re-copy in case the clipboard got clobbered. Falls back gracefully if clipboard API is denied (fallback path in current code already handles this).
- **Primary CTA = Share / Save** (full-width). Download moves to a small text link below ("Or download to Files"). On iOS the Share sheet hits Photos save reliably; Download is anchor-with-`download` which iOS ignores anyway.
- **"I posted it on Facebook" close-out button** at the bottom (full-width, blue). Tap → `POST /api/posts/[id]/manual-publish` `{ platform: "FACEBOOK_PERSONAL" }`. Server creates or updates the relevant `PublishRecord`:
  - `platform = "FACEBOOK_PERSONAL"`
  - `status = "PUBLISHED"`
  - `publishedAt = now`
  - `manualPostedAt = now` (new optional field, see schema section)
- After successful close-out → page navigates back to `/admin/suggest`. The "Manual posts to do" inbox count drops by one.

#### 3c. Push notification deep-link (no change needed)

Existing push pipeline (`/api/cron/push-reminders`) already deep-links into `/admin/m/[postId]`. No backend change. The improvements above (auto-copy, share-primary, close-out) make the post-tap experience faster regardless of whether the user came via push or cold-opened the app.

### 4. Easy undo for accepts

The existing `POST /api/planner/propose` (`SuggesterClient.tsx:91`) creates a `WeeklyPlanSlot`. For undo to work cleanly, the response must include the new slot's `id`, which the client holds in the snackbar's state for 5 seconds. Tapping Undo fires `DELETE /api/planner/slot/[slotId]`.

Verify these endpoints already exist (via `git grep`); if `propose` doesn't return the slot id, augment it.

### 5. Delete `/admin/rate`

Files to remove:

- `src/app/admin/rate/` (the whole directory: `RateQueue.tsx`, `RatingCard.tsx`, `page.tsx`)
- The sidebar entry in `src/components/layout/Sidebar.tsx:39` (`{ type: "link", href: "/admin/rate", label: "Review Posts", icon: Star }`) and the now-unused `Star` icon import.
- Any `/api/ratings/queue` route or similar that was only used by RateQueue. (Star ratings themselves stay — they're surfaced elsewhere; only the swipe-queue UI goes.)

After removing, grep for `"/admin/rate"` and `RateQueue` / `RatingCard` imports to make sure nothing else references the deleted page. Run `npm run build` to catch broken links/imports.

## Data model changes

Two small additions:

### `Post.notReadyReasons`

No schema change. Just a new string value `"skipped-in-suggester"` in the existing array column. Document the canonical reason set in `src/lib/readiness.ts` so future readers know what's allowed.

### `PublishRecord.manualPostedAt`

Optional `DateTime?` column. Lets us tell apart "API-published" from "user clicked I-posted-it". Used by analytics and by the manual-fb-pending query to exclude already-handled rows.

```prisma
model PublishRecord {
  // ... existing fields ...
  manualPostedAt   DateTime?
}
```

Migration generated offline via `prisma migrate diff` per CLAUDE.md, applied with `psql -f` and resolved with `prisma migrate resolve`.

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/planner/skip` | POST | Mark post skipped → adds `"skipped-in-suggester"` reason |
| `/api/planner/skip/undo` | POST | Remove the reason; recompute readiness |
| `/api/planner/slot/[slotId]` | DELETE | Undo an accepted slot (existing or to be exposed) |
| `/api/planner/manual-fb-pending` | GET | Inbox of FB-personal slots needing manual posting |
| `/api/posts/[id]/manual-publish` | POST | Mark a post manually published on a given platform |

All require an admin session. Where an existing endpoint already covers the job (e.g. slot delete may already exist), reuse it; only add what's missing.

## Error handling

- **Skip endpoint failures** must not strand the card. If the API call fails, keep the candidate visible and show a toast — no client-side state change.
- **Manual-publish failures** keep the user on `/admin/m/[postId]` with an error banner. The "I posted it" button doesn't navigate until the server confirms.
- **Auto-copy refusals** (Safari clipboard policies) silently fall back to the existing textarea-and-`execCommand` workaround. The "Caption copied" banner only shows on success.
- **Auto-slot exhaustion**: if `findNextOpenSlot` returns `null` (already handled at `next-candidate/route.ts:138`), the card empty-state shows "All slots full for the next 8 weeks — open the calendar to free one up."

## Testing

- Unit: extend `src/lib/readiness.test.ts` to cover `"skipped-in-suggester"` carry behaviour and the undo path.
- Integration: minimal — endpoints get small route tests (skip + undo + manual-publish) using the same mock-prisma pattern as `e72cfe4` (recent test added for chat route).
- UX/mobile: per CLAUDE.md, Eitan tests on his phone. The implementation plan should call this out before declaring done. Specifically:
  - One-by-one drag works on iOS Safari (real, not chrome devtools).
  - Inline caption tap-to-edit doesn't trigger a swipe.
  - Snackbar undo within 5s actually undoes.
  - `/admin/m/[postId]` auto-copy + Share / Save → Photos.
  - "I posted it" updates the slot and removes it from the inbox tile.

## Open questions

1. **`FACEBOOK_PERSONAL` as a platform value.** I haven't checked whether `WeeklyPlanSlot.platforms` already includes a `FACEBOOK_PERSONAL` value, or whether manual-FB is implicit (e.g. inferred from "FB personal reminder" toggle in `OneByOneCard.tsx:54`). The implementation plan needs to inspect this and either reuse a flag or add one. If the reminder toggle is a transient UI thing today, we'll need a persisted `slot.fbPersonalManual: boolean` (or platform value) to power the inbox query.
2. **Star ratings.** Confirm star ratings are surfaced somewhere other than `/admin/rate` (e.g. on the all-posts list, the post detail page, or the assistant) before deleting the swipe-rate queue. If `/admin/rate` is the *only* place ratings are entered, we lose the ability to rate posts unless we add a star control elsewhere. Eitan to confirm. (The schema's `Rating` table stays either way; this is purely about whether we lose an entry surface.)

These two are surface-level — they get resolved in the implementation plan, not by re-opening the design.

## File / module map

**Edited:**

- `src/app/admin/suggest/SuggesterClient.tsx` — manual-fb-pending tile, prefetch, undo snackbar, simplified accept payload (no slot picker).
- `src/app/admin/suggest/OneByOneCard.tsx` — drag gestures, auto-slot read-only line, inline caption, platform-disable rules, removed slot picker.
- `src/app/admin/m/[postId]/ManualPostHelper.tsx` — auto-copy banner, primary Share CTA, "I posted it" button.
- `src/lib/readiness.ts` — document new reason; preserve it in `computeReadiness` carry semantics.
- `src/app/api/cron/readiness/route.ts:60` — extend `carry` filter to include `"skipped-in-suggester"`.
- `src/components/layout/Sidebar.tsx` — remove Review-Posts entry + Star import.
- `prisma/schema.prisma` — `PublishRecord.manualPostedAt` field.

**Added:**

- `src/app/api/planner/skip/route.ts` — POST + POST /undo.
- `src/app/api/planner/manual-fb-pending/route.ts` — GET inbox.
- `src/app/api/posts/[id]/manual-publish/route.ts` — POST close-out.
- `prisma/migrations/<timestamp>_publish_record_manual_posted_at/migration.sql`.

**Deleted:**

- `src/app/admin/rate/` (whole directory).
- Any `/api/ratings/queue` route used only by the deleted page.

## Rollout

Single PR, single deploy. No feature flag — the Suggester is the user's primary scheduling surface, and these are continuous improvements to it.

Migration applied to prod *before* the deploy (so the new `manualPostedAt` column exists when the new code reads it). Standard CLAUDE.md flow:
`prisma migrate diff` → `psql -f` → `prisma migrate resolve --applied`.

After deploy, Eitan tests on his iPhone:
1. Swipe-skip → check it shows up in Triage with the new label.
2. Swipe-accept → undo within 5s.
3. Open `/admin/m/[id]` cold → see auto-copy banner; Share → Photos saves; tap "I posted it" → returns to suggester with inbox count decremented.
4. Confirm "Review Posts" sidebar entry is gone and `/admin/rate` 404s (or redirects to `/admin/triage`).
