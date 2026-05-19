# Threads + Substack publishing — design

Date: 2026-05-19
Status: Draft (awaiting approval)

## Goal

Add two new publishing destinations to the CMS:

1. **Threads (Meta)** — full official-API integration. Same automation level as Instagram/LinkedIn/TikTok/YouTube/Facebook Page.
2. **Substack** — manual-helper integration. Substack has no posting API in 2026; we mirror the existing `manual-fb` queue pattern.

## Why this split

- **Threads** has an official Meta API (`graph.threads.net/v1.0`) that supports text, images, video, and carousels via a 2-step container/publish flow. It's basically Instagram's pattern with different scopes. Fully automatable.
- **Substack** has no posting API. Their April 2026 "Developer API" only reads public profile data. The realistic non-fragile path is the manual-helper pattern the codebase already uses for personal-profile Facebook (`/admin/manual-fb`) — a queue UI that hands the user off to the platform's editor with the content pre-filled / copied to clipboard, then captures the resulting permalink.

## Scope

### In

- `THREADS` and `SUBSTACK` added to `enum Platform` (Prisma).
- New `src/lib/platforms/threads.ts` with `postToThreads(...)` for text, single image, single video, and carousels (≤20 items).
- New `src/app/api/connections/threads/{route.ts,callback/route.ts}` for OAuth.
- New env vars: `THREADS_APP_ID`, `THREADS_APP_SECRET`. (Threads is a separate product within the existing Meta app — same developer account, but its own client ID/secret are issued.)
- Token storage in `PlatformToken` under `platform = 'THREADS'`, including refresh-on-expiry helper similar to Instagram's long-lived flow.
- Threads added to the publish dispatch in `src/app/api/posts/[id]/publish/route.ts`.
- Threads added to `ConnectionsPage.tsx` with appropriate capability matrix.
- New `/admin/manual-substack` page mirroring `/admin/manual-fb`: queue of pending Substack publishes, "Open in Substack" action that copies body to clipboard and opens the Substack editor URL, "Mark published" with permalink capture.
- Tiny "Substack settings" affordance to store the user's publication URL (we need to know which Substack to open).
- Substack added to `ConnectionsPage.tsx` as a manual-only row.

### Out

- Threads insights / analytics endpoints (publish-only this round).
- Threads replies / reply-controls.
- Threads stories (not a format in Threads).
- Substack analytics, drafts API, comments — no API exists.
- Bulk import of historical Substack posts.

## Data model

```prisma
enum Platform {
  FACEBOOK
  FACEBOOK_PAGE
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
  THREADS      // new
  SUBSTACK     // new
}
```

No new tables. Both platforms reuse `PublishRecord` and `PlatformToken` (Threads only — Substack has no token row).

New scalar settings stored as plain user-scoped config (re-using the same place existing `OWNER_USER_ID` user-prefs live, or a tiny new `User.substackPublicationUrl String?` column — to be decided during plan-writing; either is trivial).

## Threads — implementation outline

### `src/lib/platforms/threads.ts`

Mirrors `instagram.ts`:

```ts
export async function postToThreads(
  auth: { accessToken: string; platformUserId: string },
  text: string,
  mediaKeys: string[],
  postType: PostType,
): Promise<{ platformPostId: string; platformUrl?: string }>
```

Internal helpers:

- `createTextContainer(text)` → `containerId`
- `createImageContainer({ imageUrl, text? })` → `containerId`
- `createVideoContainer({ videoUrl, text? })` → `containerId` (poll for `status === FINISHED`)
- `createCarouselContainer(childContainerIds, text)` → `containerId`
- `publishContainer(containerId)` → `mediaId` (the Threads post id)
- `getPermalink(mediaId)` → `https://threads.net/...`

Base URL `https://graph.threads.net/v1.0`. Uses `fetchWithTimeout` from `_fetch.ts`.

### OAuth

`/api/connections/threads/route.ts` redirects to:

```
https://threads.net/oauth/authorize
  ?client_id=THREADS_APP_ID
  &redirect_uri={APP_URL}/api/connections/threads/callback
  &scope=threads_basic,threads_content_publish
  &response_type=code
```

`/api/connections/threads/callback/route.ts`:

1. Exchanges `code` for a short-lived token at `https://graph.threads.net/oauth/access_token`.
2. Exchanges that for a long-lived (60-day) token at `https://graph.threads.net/access_token?grant_type=th_exchange_token`.
3. Encrypts and upserts a `PlatformToken` row with `platform = 'THREADS'`, storing `platformUserId` from `/me`.

Refresh helper `refreshThreadsToken(userId)` follows the IG long-lived pattern; called from `publishNow` when the token is within ~7 days of expiry.

### App Review

`threads_content_publish` requires Meta App Review for general availability. In **development mode** the app developer (Gil) can publish to his own account immediately without review. That covers the actual use case here; full review can wait until/if other users need it.

## Substack — implementation outline

### `/admin/manual-substack` page

Structure copies `/admin/manual-fb`:

- Server component (`page.tsx`) loads the queue: posts that have a Substack `PublishRecord` with `status ∈ {SCHEDULED, APPROVED, PENDING}` and no `publishedAt`. (Match exactly whatever statuses manual-fb uses — implementation detail for the plan.)
- Client component (`ManualSubstackQueueClient.tsx`) renders cards anchored on scheduled time, same visual language as manual-fb queue.
- Each card:
  - "Copy body to clipboard & open Substack" — copies the post body (Markdown) and `window.open(substackPublishUrl)`. The publish URL is `${publicationUrl}/publish/post` if the user has set their publication URL; otherwise the helper shows a one-time prompt to enter it.
  - Image attachments shown as previews with one-click "Open image" links (Substack's editor doesn't accept URL params for media uploads, so the user pastes/uploads them by hand).
  - "Mark published" input that accepts the Substack permalink → updates `PublishRecord` to `PUBLISHED`, fills `platformUrl` and `publishedAt`.
- Reuses the existing helpers in `/api/admin/manual-fb-queue/route.ts` *only as a pattern* — Substack gets its own `/api/admin/manual-substack-queue` and `count` routes.

### Substack settings

Add a small section on `/admin/connections` (under the Substack row) — input for the publication URL like `https://gilalter.substack.com`. Persist to `User` (column `substackPublicationUrl`) or to a settings row, depending on what's least invasive in the plan stage.

### Publish dispatch

Substack is **excluded** from the `switch (platform)` in `src/app/api/posts/[id]/publish/route.ts` (same way `FACEBOOK` personal is excluded today — only `FACEBOOK_PAGE` is in the switch). Substack `PublishRecord` rows are created by the scheduler / planner but never picked up by the cron-publisher; they're surfaced only in the manual queue.

## Connections UI

`ConnectionsPage.tsx` adds two rows in the standard order:

| Platform | Text | Photos | Video | Stories | Analytics | Page | Personal | Note |
|---|---|---|---|---|---|---|---|---|
| Threads | ✓ | ✓ | ✓ | – | – | – | ✓ | |
| Substack | ✓ | ✓ (manual) | – | – | – | – | ✓ | Manual helper — no public API |

Substack has no "Connect" button — instead, a "Configure publication URL" link to a small form (or inline edit).

## Error handling

- Threads errors propagate through the existing `PublishRecord` failure path (`status = FAILED`, `error` populated). Specific cases worth surfacing: container still PROCESSING after timeout (poll with bounded retries, then mark failed); long-lived token expired (attempt refresh once, then fail with reconnect prompt).
- Substack helper has no failure modes from the platform — the user is the failure mode. We do validate that "Mark published" got a URL that starts with the configured publication URL, to catch paste mistakes.

## Testing

- `src/lib/platforms/threads.test.ts` — unit tests with mocked fetch covering text-only, single image, single video (with polling), and carousel paths. Mirrors `youtube.test.ts` shape.
- Manual-substack: rely on existing manual-fb integration patterns; no dedicated test (matches manual-fb today).
- Type-check + existing test suite green before merge.

## Migration

New `Platform` enum values via the project's standard recipe:

```bash
export DATABASE_URL="$POSTGRES_URL_NON_POOLING"
npx prisma migrate diff \
  --from-schema-datasource prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script -o migration.sql
psql -f migration.sql
npx prisma migrate resolve --applied add_threads_substack_platforms
```

Adding values to a Postgres enum is non-blocking (`ALTER TYPE ... ADD VALUE`); no data backfill required.

## Env vars

Add to `.env.local` and push to Vercel (preview + production) via `vercel env add`:

- `THREADS_APP_ID`
- `THREADS_APP_SECRET`

No Substack secrets — no API.

## Rollout order

Single PR (or two PRs if the Threads OAuth setup drags) — they're independent on the codebase level. Order inside the PR:

1. Prisma enum migration.
2. `threads.ts` + tests.
3. Threads OAuth routes.
4. Publish-dispatch switch update.
5. Substack manual queue page + API routes.
6. Connections UI rows for both.
7. Env-var docs update.

## Open assumptions (flagged for plan stage)

- The exact Substack publication URL persistence (new `User` column vs. existing settings store) is decided during plan-writing — both are <10 LOC.
- Manual-substack queue source — does the user schedule Substack via the weekly planner (slot-based, like FB personal) or via a per-post platform checkbox (like LinkedIn/IG)? Substack posts tend to be long-form essays that don't map well to weekly slots, so the per-post checkbox model is the default; the plan stage will confirm by reading how Substack-bound posts currently flow through the assistant.
