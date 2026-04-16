# Assistant — Phase 2 Design

**Date:** 2026-04-16
**Status:** Draft (written autonomously while user asleep; review before plan)
**Builds on:** `2026-04-15-assistant-foundation-design.md`

## Motivation

Phase 1 built the signals (readiness, ratings, lifecycle/season). Phase 2 builds the **agent that consumes them** — a single conversational surface where Gil can ask:

- "What should I post today?"
- "Find me that post about the olive tree."
- "Schedule three things for next week, one per platform."
- "What did I write about grief last fall?"

Today Gil has a weekly planner and a chat, but they're separate, neither uses readiness/ratings/lifecycle, and the chat has no write tools. Phase 2 unifies them into one assistant with retrieval + scheduling tools, grounded in the Phase 1 signals.

## Non-goals

- No public-facing assistant changes. `/chat` stays as-is.
- No new analytics/reach signals; ratings remain the taste source.
- No autonomous posting — assistant proposes, Gil confirms.
- No embeddings infrastructure in this phase (tag + keyword retrieval is sufficient for the archive size; revisit if recall is poor).
- No new platform integrations.

---

## 1. Surface

Single route: `/admin/assistant` (replaces the separate planner chat; the weekly-planner UI stays accessible at `/admin/planner` for direct grid editing).

- Left column (desktop) / collapsible drawer (mobile): **context rail** showing the day's recommendations, scheduled queue, and rating progress — all live, clickable to drop into the chat.
- Main column: chat thread with tool-use, streaming, and inline "cards" rendered from tool results (post previews, schedule confirmations, search hits).
- Sticky composer with quick-action chips: `What should I post today?` · `Find a post…` · `Schedule next week` · `Review unready`.

Threads are ephemeral (per-session) in this phase; persistence is a later add.

---

## 2. Recommendation engine

Pure, deterministic scorer in `src/lib/assistant/recommend.ts`. The assistant calls it via a tool; the context rail also renders its top-N.

### Input

```ts
recommend({
  userId: string,
  when: Date,                  // target post date (defaults to now)
  platform?: Platform,         // optional filter
  kind?: PostKind,             // POST | STORY | REEL
  excludePostIds?: string[],
  limit?: number,              // default 10
})
```

### Candidate pool

Posts where:
- `userId` matches
- `readiness = READY`
- `share IS NULL` (no FB shares — preserved from existing planner)
- no `PublishRecord` with `status=PUBLISHED` in the last **90 days** (recency floor — was 4 weeks in planner; bumped because ratings now let us be pickier)
- no `PublishRecord` with `status=PENDING` and `scheduledAt >= now`

### Score (higher = better)

```
score =
   w_rating   * ratingScore        // stars: 1★=-0.4, 2★=-0.1, 3★=0.2, 4★=0.6, 5★=1.0; unrated=0.15
 + w_fitness  * lifecycleFit       // EVERGREEN=1.0; SEASONAL matches current season=1.0, adjacent=0.3, off-season=-1.0; EPHEMERAL=-0.8; UNKNOWN=0.2
 + w_freshness * freshness         // 1 - exp(-monthsSinceLastPublish / 24); never-published=1.0
 + w_variety  * tagVariety         // 1 - jaccard(tags, tagsPublishedLast30d) averaged
 + w_diversity * kindDiversity     // -1 if last 3 publishes share kind, 0 otherwise
 - penalty_reasons                 // any negative rating reason repeated across ≥3 peers tagged the same → small penalty
```

Default weights (tunable via constants, not env):
`w_rating=1.0, w_fitness=0.9, w_freshness=0.6, w_variety=0.4, w_diversity=0.3`.

Scorer returns `{ postId, score, breakdown }` so the UI can show *why*.

### Season resolution

`currentSeason(date, hemisphere='N')` — fixed month buckets (Dec-Feb Winter, etc). Hemisphere hardcoded N; single-user app.

### Output

Ranked list, ties broken by `originalDate ASC` (prefer older, under-served posts).

### Testing

Pure function: unit tests in `src/lib/assistant/recommend.test.ts` covering each factor in isolation and representative combinations. No DB; tests pass in fixtures.

---

## 3. Retrieval for archive Q&A

`src/lib/assistant/retrieve.ts` — two-stage search, no embeddings:

1. **Tag mapping** (reuse `/api/posts/ai-search` logic): Claude Haiku maps query → `{ tags: string[], keywords: string[], lifecycleHint?, seasonHint? }`.
2. **SQL filter + rank**: Prisma query AND-ing tag matches, OR-ing keyword `ILIKE` over body, optional lifecycle/season filters, optional date range; ranked by `(tagMatchCount * 2 + keywordHits) / 3 + ratingBoost`.

Returns top 20 with `{ post, highlightSnippet, matchReasons }`.

When the assistant needs Q&A *over* results (not just listing), it takes the top 8 posts, loads their bodies, and re-prompts Claude with them as context to answer the user's question with citations (`[post:abc123]` rendered as clickable chips).

---

## 4. Assistant agent

`src/app/api/assistant/route.ts` — streaming chat with tool use.

### Model

`claude-sonnet-4-6` with `tool_choice: auto`, streaming.

### System prompt (sketch)

> You are Gil's post assistant. You help him decide what to post, find things in his archive, and schedule work. Today is {date}. You have {readyCount} ready posts, {ratedCount} rated. Use tools; do not hallucinate post content. When you cite a post, use the `[post:ID]` syntax exactly — the UI renders it as a card.

Injected at turn start: compact stats block (counts, scheduled-this-week summary, current season).

### Tools

| Tool | Purpose |
|---|---|
| `recommend_posts` | Wraps the scorer. Args: `{ when?, platform?, kind?, limit? }`. |
| `search_archive` | Wraps retrieval. Args: `{ query, limit?, lifecycle?, season?, dateRange? }`. |
| `get_post` | Full post body + media + ratings + publish history for an id. |
| `list_scheduled` | PublishRecords in a date range, grouped by day/platform. |
| `schedule_post` | Creates a `PublishRecord` (status=PENDING). Args: `{ postId, platform, scheduledAt, caption? }`. Returns the record. |
| `unschedule` | Deletes a PENDING record by id. |
| `answer_from_posts` | Takes `postIds[]` + question, loads bodies, returns a grounded answer with `[post:id]` citations. (Implemented as an internal sub-call to Claude, not a separate Sonnet agent.) |

All tools validate `userId` from session; never trust ids from the model without ownership check.

### Guardrails

- `schedule_post` requires `readiness=READY` and no existing PENDING for the same post within 24h of the target time; otherwise returns a structured error the agent can relay.
- Destructive tools (`unschedule`) return a confirmation payload; the UI shows a confirm button before the second call actually executes.
- Max 6 tool iterations per turn; if exceeded, return a "needs narrowing" message.

### Streaming + tool UI

- Server streams text + tool_use blocks via `ReadableStream`.
- Client renders tool invocations as live "cards" (pending → resolved), so the user sees what the agent is doing.
- Recommended/search result cards show: thumbnail, body preview (2 lines), stars, lifecycle chip, score breakdown popover, action buttons (`Schedule…`, `Open`).

---

## 5. Scheduling flow

The assistant does not pick a platform silently. When asked to "schedule X for next Tuesday":

1. `recommend_posts` (or user-specified `get_post`) → candidate.
2. Agent proposes `{ postId, platform, scheduledAt }` in a **plan card** in chat.
3. User taps ✓ → client calls `schedule_post`; agent confirms and shows a "Next up" card linking to `/admin/scheduled`.

Direct manual scheduling at `/admin/calendar` and `/admin/planner` is unchanged.

### Daily brief (optional, behind a toggle)

Cron `/api/cron/daily-brief` at 7am: runs `recommend_posts({ limit: 3 })` per enabled user, stores result in new `DailyBrief` row (`date`, `userId`, `payload Json`). The assistant rail renders today's brief on open. No email/push in this phase.

---

## 6. Data model changes

Minimal.

```prisma
model DailyBrief {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  date      DateTime @db.Date
  payload   Json      // [{ postId, score, breakdown }]
  createdAt DateTime @default(now())

  @@unique([userId, date])
  @@index([userId, date])
}
```

No changes to `Post` or `PostRating` — Phase 1 already carries what's needed.

---

## 7. File layout

```
src/lib/assistant/
  recommend.ts            pure scorer
  recommend.test.ts
  retrieve.ts             tag-map + SQL search
  retrieve.test.ts
  tools.ts                tool schemas + handlers (pure server-side fns)
  tools.test.ts
  prompt.ts               system prompt builder
src/app/api/assistant/
  route.ts                streaming chat endpoint
  brief/route.ts          GET today's brief
src/app/api/cron/
  daily-brief/route.ts
src/app/(auth)/admin/assistant/
  page.tsx                chat surface
  _components/
    Composer.tsx
    ThreadView.tsx
    ContextRail.tsx
    PostCard.tsx
    PlanCard.tsx
```

The existing `/admin/planner` weekly grid stays; the old `/api/chat/planner` is deleted — `assistant/route.ts` subsumes it.

---

## 8. Testing strategy

- **Pure fns**: full unit coverage for `recommend.ts`, `retrieve.ts` query builder, tool argument validators.
- **API routes**: integration tests for `/api/assistant` (mock Anthropic client to return deterministic tool_use sequences) and `/api/cron/daily-brief`.
- **Tool handlers**: hit dev DB; assert ownership checks reject cross-user ids.
- **UI**: per project convention, user verifies.

---

## 9. Rollout

1. Prisma migration (adds `DailyBrief`).
2. Land `recommend.ts` + tests; expose via `/api/assistant/debug/recommend` (dev-only) to sanity-check scoring.
3. Land `retrieve.ts` + tests.
4. Land tool handlers + `/api/assistant` streaming route; keep old `/api/chat/planner` until UI cutover.
5. Ship `/admin/assistant` UI behind a sidebar link; keep planner link.
6. Enable daily brief cron last.
7. Delete `/api/chat/planner` and the old planner chat UI.

## 10. Open decisions (resolved here pending user review)

- **Embeddings now?** No — tag+keyword on ~1000 posts is fine; revisit if users report missed recalls.
- **Persist threads?** No — v1 is per-session; a follow-up can add a `Conversation` table.
- **Platform auto-selection?** No — assistant always proposes a specific platform and the user confirms; auto-selection is Phase 3.
- **Negative reason penalty tuning?** Start simple (-0.15 per shared negative reason with ≥3 peers); adjust after real usage.

## Dependencies for Phase 3 (future)

- Persistent threads + memory
- Embeddings for semantic recall
- Auto-publish with confidence threshold
- Reach/engagement ingestion → blend into `ratingScore`
