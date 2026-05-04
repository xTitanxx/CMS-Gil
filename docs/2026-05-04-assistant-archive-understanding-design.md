# Assistant Archive Understanding

**Status:** approved · **Date:** 2026-05-04 · **Branch:** `feature/assistant-archive-understanding`

## Problem

The assistant at `/admin/assistant` currently knows the archive only through tool calls (`search_archive`, `get_post`). For tasks like "draft me a new post," this is too thin — it can't write in Gil's voice without examples in front of it, and it doesn't reliably know whether a topic has been covered before.

The user wants the assistant to *really know* the archive: write fluently in his style and avoid suggesting things he's already published.

## Out of scope

- Public chatbot at `/chat` (separate surface, separate prompt — could inherit later)
- Embeddings / vector search (existing tag+keyword retrieval is sufficient for v1)
- Per-conversation memory beyond what `UserMemory` already does

## Approach

A new "smart understanding" layer pinned into the cached system prompt. Three components, all generated offline and refreshed weekly:

1. **Voice profile** — distilled prose describing how Gil writes (~3K tokens)
2. **Thematic map** — what he writes about, with rough proportions (~2K tokens)
3. **Curated sample bodies** — ~30 representative full-text posts, stratified across themes/years/lengths (~7K tokens)

Total cost added to the cached system prompt: **~12K tokens**.

The existing tools (`search_archive`, `get_post`, `recommend_*`) stay unchanged — they handle deep recall when the assistant needs the actual body of a specific post.

### Why this shape

- **Content over metadata.** Date/kind/stars are weak signals; the actual writing is what carries voice and topic both. So the budget goes to bodies, not index lines.
- **Sample over exhaustive.** 30 stratified posts are enough for the model to internalize voice; the rest sit behind retrieval.
- **One knob.** Sample size is a single parameter. v1 ships at 30; bumping to 60 is a config change, not a redesign.
- **Cached.** Lives inside the same `cache_control` block as the rest of the system prompt — only re-read on cache miss.

### Cost

| Scenario | Cost |
|---|---|
| Cold opener (>5 min idle) | ~$0.08 |
| Warm message | ~$0.025 |
| Heavy daily use (10 sessions) | ~$1/day, **~$30/month** |

Generation cost (weekly cron): one Sonnet call (~$0.06) + one Haiku call (~$0.01) per user.

## Data model

New table:

```prisma
model UserArchiveUnderstanding {
  userId            String   @id
  voiceProfile      String   @db.Text
  thematicMap       String   @db.Text
  sampleBodies      Json     // Array<{ id, originalDate, body, tags, theme }>
  generatedAt       DateTime @default(now())
  basedOnPostCount  Int

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

One row per user, upserted by the generator. JSON column for `sampleBodies` keeps it flexible without spawning another join.

## Generation pipeline

`src/lib/assistant/archive-understanding.ts` exports `buildUnderstanding(userId)`:

1. **Load posts.** All posts where `userId = userId AND body <> '' AND readiness != 'ARCHIVED'`. Pull `id, body, tags, originalDate, postType`.
2. **Cluster themes.** Take the top 100 tags by frequency. Send them to Haiku with: *"Group these tags into 8–12 thematic clusters. Output JSON: `{ themes: [{ name, tags: [...] }] }`."*
3. **Stratified sample.** For each theme, pick `ceil(SAMPLE_SIZE / themeCount)` posts whose tags overlap that theme. Within a theme, diversify by year (oldest, middle, newest tier) and length (short, medium, long buckets).
4. **Voice profile.** Send the sample bodies to Sonnet with: *"Read these posts by Gil. Write a one-page profile of his writing voice — typical openings, sentence rhythm, tone, language mix, recurring moves, what he avoids. Plain prose, ~600 words."*
5. **Thematic map.** Send the theme clusters + per-theme post counts to Haiku: *"Write a short paragraph describing what Gil writes about, with rough proportions. ~250 words."*
6. **Persist.** `prisma.userArchiveUnderstanding.upsert({ where: { userId }, ... })`.

Constants:
- `SAMPLE_SIZE = 30` (configurable later)
- `MIN_BODY_CHARS = 50` (skip empty / one-word bodies)
- `THEME_COUNT_TARGET = 10`

## Wiring into the assistant

`buildSystemPrompt` (in `src/lib/assistant/prompt.ts`) loads the row in its `Promise.all` and appends a new block:

```
Gil's writing — internalized:

VOICE:
{voiceProfile}

WHAT HE WRITES ABOUT:
{thematicMap}

REPRESENTATIVE POSTS (full text — use these to ground tone, not as content to recycle):
[post:abc123 | 2024-03-15 | tags: garden, bunny]
<body>

[post:def456 | ...]
<body>
...
```

If the row is missing (new user, never generated), the block is omitted entirely — the assistant degrades gracefully to today's behavior.

The block sits inside the existing `cache_control: { type: "ephemeral" }` system prompt — no new cache breakpoint needed.

### Behavioral guidance in the prompt

A short instruction added below the block:

> Use the voice and themes above to draft new posts in Gil's style. The representative posts are *examples of how he writes*, not content to recycle — never quote them verbatim or rewrite them as "new" posts. When asked whether he's written about a topic before, treat the thematic map as orientation but call `search_archive` for definitive answers.

## Refresh

- **Weekly cron** at `/api/cron/archive-understanding` — Sundays 04:00 UTC, gated by `CRON_SECRET`. Iterates every user with ≥ 50 posts and rebuilds. Add to `vercel.json`.
- **Manual rebuild** at `POST /api/assistant/archive-understanding/rebuild` — auth-gated, lets the user kick off a regeneration on demand from the assistant ("rebuild your understanding of my archive").

A weekly cadence is fine because voice doesn't shift overnight. New posts published in between still surface via `search_archive`.

## Tests

- **`archive-understanding.test.ts`**:
  - Stratified sampling picks N posts with diversity across theme / year / length
  - Skips bodies < `MIN_BODY_CHARS`
  - Handles user with < `SAMPLE_SIZE` posts (returns all available)
- **`prompt.test.ts`** (extend existing):
  - System prompt includes the understanding block when the row is present
  - System prompt omits the block when the row is absent (no errors, no orphan headers)

## Observability

The cron logs `{ userId, postCount, themeCount, sampleSize, durationMs }` per user. The `UserArchiveUnderstanding.generatedAt` timestamp is the source of truth for freshness — the manual-rebuild endpoint returns it so the UI can surface "last refreshed: X days ago" later.

## Migration / rollout

1. Ship the schema migration (additive, zero risk to existing rows).
2. Ship code with the prompt block hidden behind "row exists" check.
3. Manually run rebuild for the existing user via the new endpoint.
4. Confirm assistant behavior in `/admin/assistant`.
5. Cron picks it up next Sunday.

No feature flag needed — the "row exists" check is the flag.

## Open questions

None blocking. Future iterations could:
- Bump `SAMPLE_SIZE` if the voice still feels generic.
- Add a "tone variant" knob (formal / casual / bilingual-heavy) and let the user pick.
- Switch to embedding-based sampling if tag-cluster sampling misses important sub-styles.
