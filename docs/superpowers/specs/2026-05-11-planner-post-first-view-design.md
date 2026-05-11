# Planner: post-first view + Suggester schedule-direct

**Date:** 2026-05-11
**Status:** Approved by user, in implementation.

## Problem

After a Suggester session, the user wants a clean way to review what they just committed to publishing — with the post (media + caption) as the visual hero, day-grouped, ordered nearest-publish first. The current Planner timeline works but is "messy on the eye, doesn't give an amazing overview, especially on mobile." The existing 5-second Undo snackbar covers the "oops" case but nothing covers "let me look back and fix something" after the session.

Today's surfaces:
- Suggester menu has a small "Just scheduled" text list (last 5) — non-interactive.
- Suggester one-by-one has a pill strip of accepted slots (last 6, day + hour only) — non-interactive.
- Planner shows a dense slot card with thumb + caption clamp + meta + buttons (`PlanSlotCard.tsx`, ~300 lines).

The Planner is the right canonical surface; the Suggester's in-session widgets should go away in favor of pointing at the upgraded Planner.

## Goals

1. **Post is the hero.** Media + caption are the primary content. Tags / rating / AI reasoning / repost count are secondary.
2. **Ordered nearest-publish first.** Day-grouped, slots within day in time order. Today is at the top.
3. **Mobile-first.** Tuned for iPhone-SE width (~375px). The user reads on his phone.
4. **Edit-from-here.** Inline caption edit, unschedule, view original, open detail — all reachable in one tap on each card.
5. **What's going public is what's shown.** Suggester-accepted slots are scheduled immediately (no PROPOSED middle state for that path). Today's already-published slots stay visible (greyed) so the day reads end-to-end.

## Non-goals

- Reschedule UI (swap day/hour) on the card. Unschedule + re-suggest is the replacement.
- Swap-post UI. Same: unschedule frees the slot for the next Suggester run.
- Surfacing past *days*. Yesterday-and-earlier disappear at midnight.
- New Prisma schema fields.

## Design

### File layout

**New**
- `src/lib/planner/platforms.ts` — `PLATFORM_META` + `dedupePlatforms`, extracted so the assistant components don't depend on `PlanSlotCard`.
- `src/app/admin/planner/PostSlotCard.tsx` — post-first card.
- `src/app/admin/planner/EmptyDayPill.tsx` — one-line collapsed empty-day row.

**Rewritten**
- `src/app/admin/planner/DayGroup.tsx` — chooses full vs collapsed-pill per day; renders `PostSlotCard` for non-empty days.
- `src/app/admin/planner/WeeklyPlanView.tsx` — hides past days; today renders end-to-end (including already-published slots); future days sorted ascending; empty days collapsed.

**Deleted** (only used inside `/admin/planner/`)
- `PlanSlotCard.tsx`, `PlanSlotRow.tsx`, `SlotMetaBar.tsx`, `EmptyDayRow.tsx`

**Touched (import-path swap)**
- `src/app/admin/assistant/_components/ProposalCard.tsx` → import from `@/lib/planner/platforms`
- `src/app/admin/assistant/_components/ThreadView.tsx` → same

### Card design (mobile-first)

The card stack, top to bottom:

1. **Media** — full card-width, natural aspect ratio (max-height ~60vh on mobile to prevent vertical tyranny). Video posters get a play-icon overlay. Tap the media → `/admin/posts/[id]?from=planner` (opens detail page).
2. **Time + status + platforms row** — single line: slot time chip (e.g. `Tue · 12:00`, Asia/Jerusalem implied), platform brand icons, status pill (`Scheduled` green / `Proposed` amber / `Published` grey).
3. **Caption** — readable body text, no line-clamp (full caption visible). Tap → inline edit using the existing `InlineCaptionEditor` pattern. Pencil hint icon at the top-right of the caption block.
4. **Action bar** — 4 icon buttons, evenly spaced:
   - ✏️ Edit caption (opens inline editor in place)
   - 🗑 Unschedule (removes slot + PublishRecord; toast confirms)
   - ↗ View original (external link to `post.platformUrl`, opens in new tab if present)
   - 📄 Open post detail (`/admin/posts/[id]`)

**Secondary content** (tags, rating stars, "originally posted N years ago", "reposted Nx", AI reasoning) is **not** on the card. It lives in the detail page.

**Published variant** — for today's already-published slots: card renders at ~60% opacity, status pill says "Published HH:MM", action bar collapses to **View original** + **Open detail** only (no edit/unschedule — too late).

**Proposed variant** — only seen via AI/Recycle plans (never Suggester anymore): same card, status pill says "Proposed" with amber tint. Action bar gains a primary "Schedule" button that hits `/api/planner/[planId]/schedule` with this slot's id.

### Day grouping

Above each non-empty day: a day header (e.g. `TUE · MAY 13 · 3 posts`). Today's header is highlighted (amber left border, same accent the current Planner uses).

Between non-empty days, a thin pill: `Wed · May 14 · empty`. The pill is non-interactive — empty-day filling is the Suggester's job.

### Time horizon

- **Today** — always rendered, including any already-published slots (visible greyed). Card list ordered by hour ascending.
- **Future days** — rendered ascending; empty days collapsed to pills.
- **Past days (yesterday and earlier)** — hidden entirely. They reappear in nothing; if the user wants history they go to `/admin/posts`.
- **Infinite scroll** — same sentinel-based loading as today, forward only.

### Auto-scroll-to-today

`WeeklyPlanView` mounts and scrolls today's header into view (preserves current behavior).

### Status visualization summary

| Slot status        | Border / accent     | Body tint        | Pill label        | Action bar                                  |
|--------------------|---------------------|------------------|-------------------|---------------------------------------------|
| SCHEDULED, future  | green               | cream-white      | "Scheduled · HH:MM"| Edit · Unschedule · Original · Detail       |
| SCHEDULED, today, already published | grey               | grey @ 60% opacity | "Published · HH:MM" | Original · Detail                           |
| PROPOSED (AI/Recycle plan) | amber               | warm cream       | "Proposed · HH:MM" | **Schedule** · Edit · Unschedule · Original · Detail |
| APPROVED           | amber (treated like PROPOSED) | warm cream     | same as PROPOSED  | same as PROPOSED                             |

SKIPPED slots are already filtered out by `/api/planner/current`.

### API changes

**`POST /api/planner/propose`** — accept a new optional `schedule?: boolean` field.

When `schedule === true`:
1. Existing behavior creates the slot.
2. **In addition**: create a `PublishRecord` row with `status: "PENDING"`, `scheduledAt` derived from the slot's `day` + `hour` interpreted in `Asia/Jerusalem` (use `lib/planner/fixed-slots.ts` helpers).
3. Set slot `status` to `SCHEDULED` instead of `PROPOSED`.
4. Return `{ ok: true, planId, slotId, publishRecordId }`. The Suggester's Undo flow needs `publishRecordId` so it can roll back the PublishRecord as well as the slot.

When `schedule` is absent or false: existing behavior is preserved exactly (Planner-side AI / Recycle / Assistant flows are unaffected).

**`GET /api/planner/current`** — extend each serialized slot with `published: boolean`.

Derivation: when joining `PublishRecord` for a slot's post on its day (the existing `scheduledByPostDay` map), additionally look for one with `status === "PUBLISHED"`. If found, set `published = true`. This avoids the client re-deriving from raw PublishRecord status.

### Suggester wiring

**`src/app/admin/suggest/SuggesterClient.tsx`**

- `handleAccept` calls `/api/planner/propose` with `schedule: true`. Stores the returned `publishRecordId` in `AcceptedSummary` so Undo can roll back both records.
- `handleUndo` for `kind: "accept"` now PATCHes the slot remove **and** deletes the `PublishRecord` (new endpoint or PATCH action). Simpler: extend the existing `action: "remove"` on `PATCH /api/planner/[planId]` to also delete any matching `PublishRecord` for that slot's post + scheduledAt. Already deletes-cascade via `WeeklyPlanSlot.onDelete: Cascade` for the slot itself, but `PublishRecord` is on `Post` not on slot — so the slot removal must explicitly target the matching PublishRecord.

  Implementation: in `PATCH /api/planner/[planId]` handler's `remove` action, before deleting the slot, fetch its `postId` + `day` + `hour`, compute the `scheduledAt`, and `deleteMany` PublishRecords matching `{ postId, scheduledAt, status: "PENDING" }`. Skip if status has already advanced past PENDING (don't delete published rows).
- The menu-mode "Just scheduled" list and one-by-one-mode pill strip are **removed**. The menu mode keeps a small link "View what you scheduled →" pointing to `/admin/planner` (the upgraded view IS the visualization).
- The "Skipped this session" panel stays (different mechanic, different surface — triage).

### Undo behavior (Suggester only)

The 5-second snackbar still wraps each accept. Undo now:
1. Calls `PATCH /api/planner/[planId]` with `action: "remove", slotId` — this also deletes the matching PENDING PublishRecord per the API change above.
2. Removes the slot from local `accepted[]` state.
3. Resets the candidate prefetch so the post can re-appear.

If the slot has somehow already moved past PENDING (cron raced — very unlikely given 5s window vs 5min cron tick), the PublishRecord delete is skipped and the user gets a toast: "Already published — can't undo."

### Tests

- Unit test `propose` route for `schedule: true` path — verify PublishRecord created with correct `scheduledAt` (Asia/Jerusalem hour conversion), slot status === SCHEDULED.
- Unit test the `remove` action's PublishRecord cleanup.
- Existing planner tests (if any) updated for the new component names.

### Mobile checklist

The user is on iPhone-SE (~375px) primarily. Per CLAUDE.md's mobile gate, verify each card:
- `min-w-0` on flex children with truncated text
- Caption block: full text visible, no overflow
- Action bar: 4 icons fit in the row with adequate tap targets (44×44 hit area)
- Day pill: collapses cleanly, no overflow on long day labels
- Hero media: respects max-height, no horizontal scroll

## Out of scope (deferred)

- Reschedule UI (drag-and-drop or picker).
- Multi-select on cards (bulk unschedule).
- Showing past days' published history (covered by `/admin/posts`).
- A separate "Activity feed" / "Recent actions" log — the post-first view IS the log.

## Acceptance

- A Suggester accept creates a row that immediately appears in `/admin/planner` as a SCHEDULED post-first card with green tint.
- Tapping Edit on a Planner card opens an inline caption editor; save persists to `Post.body`.
- Tapping Unschedule removes the slot AND the PublishRecord (the post will not publish).
- Tapping View Original opens the Facebook URL in a new tab.
- Tapping Open Detail navigates to `/admin/posts/[id]?from=planner`.
- Today's already-published slots are visible at ~60% opacity with a "Published HH:MM" pill.
- Empty future days appear as one-line pills.
- Past days don't appear at all.
- AI / Recycle plans still produce PROPOSED slots that need a Schedule click.
- The assistant's `ProposalCard` + `ThreadView` still render platform brand icons.
