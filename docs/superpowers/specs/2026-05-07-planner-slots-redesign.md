# Planner Slots Redesign

**Date:** 2026-05-07  
**Status:** Approved

## Overview

Three coordinated changes to the content planner:

1. The view starts at today and loads more future days automatically as you scroll (no past days, no manual "Later" tap).
2. Both Recycle and Plan Week prompt for a slot count before running — because 1 slot = 1 post at a specific time (one of 12pm / 3pm / 6pm / 9pm Jerusalem), not 1 day.
3. The AI generation call (Sonnet) writes its token cost to `AssistantUsage` so the admin $ counter reflects planner spend.

---

## 1. View — Today-forward infinite scroll

**File:** `src/app/admin/dashboard/WeeklyPlanView.tsx`

### Changes

- Remove `INITIAL_PAST = 3` constant and the `pastDays` state variable entirely.
- Remove the "Earlier" `<button>` from the rendered list.
- Keep `INITIAL_FUTURE = 10` as the initial forward window and `LOAD_MORE = 7` as the increment.
- Replace the manual "Later" button with a sentinel `<div>` at the bottom of the list. Attach an `IntersectionObserver` (in a `useEffect`) that calls `setFutureDays(d => d + LOAD_MORE)` when the sentinel enters the viewport.
- `buildDayRange` is simplified to only accept `futureDays` (no `pastDays`): builds from today UTC through `today + futureDays` inclusive.
- `DayGroup` already renders an empty state when `slots` is `[]`, so no change needed there.

### Behaviour

- On mount: view shows today + 10 future days (11 days total).
- Scroll to bottom → 7 more days appear, seamlessly.
- Past days are never shown.

---

## 2. Slot-count prompt on Recycle and Plan Week

**File:** `src/app/admin/dashboard/WeeklyPlanView.tsx`

### Interaction

Clicking either button opens a small popover anchored to the button. The popover contains:

- Label: **"How many slots?"**
- Sub-label hint: `4 = 1 full day (12 · 15 · 18 · 21)`
- Numeric input, min 1, max 56 (2 weeks × 4/day), default **7**
- A **Go** button that closes the popover and fires the generate call

Clicking outside the popover (or pressing Escape) cancels without firing anything.

### State

Two new state variables:
- `pendingMode: "AI" | "DUMB" | null` — which button was clicked
- `pendingSlots: number` — current value of the numeric input (default 7)

The popover renders when `pendingMode !== null`.

---

## 3. Generate route — slots not days, spanning weeks

**File:** `src/app/api/planner/generate/route.ts`

### API change

Body now accepts `numSlots: number` (default 7 if absent).  
The `days` array and week-boundary logic are replaced by a **slot grid**.

### Slot grid algorithm

```
slotGrid = []
day = todayUTC()
while slotGrid.length < numSlots:
  existingHours = SCHEDULED/APPROVED slots for this userId on this day (hours already booked)
  for hour in FIXED_SLOT_HOURS [12, 15, 18, 21]:
    if hour not in existingHours:
      slotGrid.push({ day, hour })
      if slotGrid.length == numSlots: break
  day += 1
```

This caps each day at the 4 fixed hours and never double-books an occupied slot.

### Multi-week WeeklyPlan upsert

Days in `slotGrid` may span multiple calendar weeks. Group by `getMondayUTC(day)` → upsert one `WeeklyPlan` per week. Collect the resulting `planId` for each day group.

### Clearing before filling

Delete all `PROPOSED` slots from each of the affected `WeeklyPlan` records (same pattern as today, extended to cover all target weeks).

### Slot creation

For each entry in `slotGrid`, create a `WeeklyPlanSlot` with:
- `planId` from the week group
- `postId` from the chosen candidate
- `day` (UTC midnight)
- `hour` explicitly set (so the schedule route uses it directly, no index-guessing)
- `status: "PROPOSED"`
- `platforms` from `getEligiblePlatforms`
- `reasoning`

### DUMB mode

Pick `candidates.slice(0, numSlots)`. Map 1-to-1 onto `slotGrid`.

Minimum check: `candidates.length >= numSlots` (was `>= 7`).

### AI mode

Pass the full slot grid to the AI prompt as the list of positions to fill:
```
Slots to fill:
- 2026-05-07 12:00
- 2026-05-07 15:00
- 2026-05-08 12:00
...
```

The AI picks one `postId` per slot. The `parseAiPicks` helper and `PLANNER_TOOLS` need minor updates to receive `{ day, hour }` pairs instead of just `{ day }`.

---

## 4. Planner AI cost → $ counter

**File:** `src/app/api/planner/generate/route.ts`

After the Sonnet `messages.create` call in AI mode:

```ts
import { priceForUsage } from "@/lib/assistant/cost";

const costUsd = priceForUsage("claude-sonnet-4-6", response.usage);
await prisma.assistantUsage.create({
  data: {
    userId,
    conversationId: "planner",
    model: "claude-sonnet-4-6",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    costUsd,
  },
});
```

`BudgetMeter` reads from `AssistantUsage` via `/api/chat/budget` → no further changes needed. The counter updates on the user's next page interaction that triggers a budget fetch.

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/admin/dashboard/WeeklyPlanView.tsx` | Infinite scroll, remove past days, slot-count popover |
| `src/app/admin/dashboard/PlannerDashboard.tsx` | Pass `numSlots` to `handleGenerate` |
| `src/app/api/planner/generate/route.ts` | Slot grid, multi-week, cost tracking |
| `src/lib/planner/prompt.ts` | Update AI tool schema for `{ day, hour }` slot format |

---

## Out of Scope

- Changing `FIXED_SLOT_HOURS` values
- Allowing the user to pick which specific hours to fill
- Modifying the schedule (`/api/planner/[planId]/schedule`) or current (`/api/planner/current`) routes — they already handle multi-week correctly
