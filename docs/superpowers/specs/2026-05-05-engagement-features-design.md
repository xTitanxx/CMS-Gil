# Engagement Features (Likes / Bookmarks / Comments / Shares) — Design Spec

**Date:** 2026-05-05
**Branch:** `feature/engagement-spec` (spec only); implementation will use phased branches per the **Phasing** section below.
**Status:** Draft — pending Eitan/Gil sign-off on the open questions before any implementation.

## Goal

Replace the currently decorative Like / Comment / Share buttons in `src/app/PublicFeed.tsx` with real, persisted engagement, and add Bookmark and a flat comment thread. Treat the public archive as a place where signed-in subscribers can react and discuss, while keeping share friction-free for everyone (including anonymous visitors) so post URLs travel.

The archive itself stays public (per PR #55). Engagement writes are subscriber-only; engagement reads (counts, comment thread) are public.

## Non-goals

- Multi-reaction picker (FB-style ❤️ / 😂 / 😢). Single Like only.
- Threaded / nested comment replies. Flat thread only.
- Notifications to subscribers (replies, likes on their comments, mentions). Defer to v2.
- Email digest to Gil of new comments. Defer.
- Anonymous likes / bookmarks / comments. Subscribers only — keeps spam surface tiny and reinforces the value of the access code.
- Share-event tracking / share counts. Web Share / clipboard fire-and-forget.
- Editing or deleting **other** subscribers' content (only own + admin moderation).
- Real-time updates (web sockets / SSE). Counts refresh on next page load or when the user themselves toggles.

## User stories

1. As a subscriber, I want to like a post so I can express that something resonated, and so Gil can see what lands.
2. As a subscriber, I want to bookmark a post so I can come back to it later from one place.
3. As a subscriber, I want to comment on a post and read what other subscribers have written.
4. As a subscriber, I want to edit my comment for a few minutes after posting if I notice a typo, and delete it whenever.
5. As anyone (anonymous or subscriber), I want a Share button so I can copy the post URL to send to a friend.
6. As Gil, I want to see comment counts and engagement at a glance, and remove a comment if needed without taking the whole thread down.
7. As Gil, I want a per-post switch to require comments to be approved before they're public, for posts that might attract heat.

## Architecture

### Subscribers, not users

All write surfaces (`like`, `bookmark`, `comments` POST/PATCH/DELETE) require `session.user.role === "subscriber" || "admin"`. Admins can do everything subscribers can plus moderate. Anonymous visitors who tap a write affordance are redirected to `/welcome?next=<original_url>` with a fragment that scrolls back to the action area (`#engagement` or `#comments`) post-login.

### Reads are public

`GET /api/posts/[id]/comments` returns the published comment thread to anyone. Like and comment counts are denormalized onto `Post` (see Data model) and rendered server-side as part of the existing public feed query — no extra round trip per card.

### Optimistic UI

Like and Bookmark toggle instantly client-side and roll back on a non-2xx response. Comments don't optimistic-render the thread (composer clears on success and the new comment is appended from the response payload — keeps moderation status accurate when `commentsRequireApproval` is on).

### Counts: denormalized + reconciled

`Post.likeCount` and `Post.commentCount` are kept on the `Post` row. Mutations update both the join table and the count column in the same sequential-await chain (no `prisma.$transaction([...])` — pgbouncer transaction-pool mode times out per the CLAUDE.md gotcha). Drift is reconciled by extending `/api/cron/readiness` (already runs daily) to recompute `likeCount = count(PostLike where postId)` and `commentCount = count(PostComment where postId and status = PUBLISHED and deletedAt is null)` for every post.

### Moderation

Default policy: comments publish immediately (`status = PUBLISHED`). Per-post `commentsRequireApproval` flag (admin-toggleable from `/admin/posts/[id]`) flips new comments on that post to `status = PENDING` until an admin approves. Pending comments are visible to their author and admins; everyone else sees a "1 comment awaiting review" stub at the bottom of the thread when there are pending items, but never the body.

### Share

Pure client-side. `navigator.share({ title, url })` where supported (mobile + Safari/Chrome desktop with HTTPS); clipboard fallback elsewhere with a toast. No server hop, no DB row, no count.

## Data model

```prisma
model PostLike {
  id           String     @id @default(cuid())
  postId       String
  subscriberId String
  createdAt    DateTime   @default(now())

  post         Post       @relation(fields: [postId], references: [id], onDelete: Cascade)
  subscriber   Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Cascade)

  @@unique([postId, subscriberId])
  @@index([subscriberId])
}

model PostBookmark {
  id           String     @id @default(cuid())
  postId       String
  subscriberId String
  createdAt    DateTime   @default(now())

  post         Post       @relation(fields: [postId], references: [id], onDelete: Cascade)
  subscriber   Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Cascade)

  @@unique([postId, subscriberId])
  @@index([subscriberId, createdAt(sort: Desc)])
}

enum CommentStatus {
  PUBLISHED
  PENDING
  HIDDEN
}

model PostComment {
  id           String        @id @default(cuid())
  postId       String
  subscriberId String
  body         String        @db.Text
  status       CommentStatus @default(PUBLISHED)
  editedAt     DateTime?
  deletedAt    DateTime?
  createdAt    DateTime      @default(now())

  post         Post          @relation(fields: [postId], references: [id], onDelete: Cascade)
  subscriber   Subscriber    @relation(fields: [subscriberId], references: [id], onDelete: Cascade)

  @@index([postId, status, createdAt])
  @@index([status, createdAt]) // moderation queue
  @@index([subscriberId, createdAt])
}
```

Additions to existing `Post`:

```prisma
model Post {
  // …existing fields…
  likeCount               Int     @default(0)
  commentCount            Int     @default(0)
  commentsRequireApproval Boolean @default(false)

  // …existing relations…
  likes      PostLike[]
  bookmarks  PostBookmark[]
  comments   PostComment[]
}
```

Additions to existing `Subscriber`:

```prisma
model Subscriber {
  // …existing fields…
  likes     PostLike[]
  bookmarks PostBookmark[]
  comments  PostComment[]
}
```

**Why denormalize counts**: feed renders 20 cards per page; `count(*)` per card per query is wasteful. Counts are eventually-consistent — the daily reconcile pass catches any drift from failed writes or race conditions.

**Why three tables and not one polymorphic "engagements"**: the access patterns are different (likes are toggles, bookmarks are per-subscriber lists, comments have body + status + lifecycle). Sharing a table would force null columns and weaken the indexes. Three small focused tables match the queries.

**Why soft-delete comments** (deletedAt + HIDDEN) instead of hard-delete: preserves thread context ("[deleted]" placeholder), enables Gil to see the original body when investigating, and lets a misclick be undone.

## API surface

All under `/api/posts/[id]/` unless noted. All return JSON. All write endpoints reject 401 if `!session`, 403 if `subscriber.revokedAt` is set, 404 if the post doesn't exist.

### Public reads

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/posts/[id]/comments?cursor=&limit=20` | `{ comments: Comment[], nextCursor: string \| null, pendingCount: number }` (only PUBLISHED + non-deleted bodies; `pendingCount` is the count of PENDING comments — body never returned to non-author) |
| `GET` | `/api/me/engagement?postIds=a,b,c` | `{ liked: string[], bookmarked: string[] }` — used by the feed/post-detail pages to render filled-in icons. Returns `{ liked: [], bookmarked: [] }` for anonymous (no 401 — UI-only enrichment). |

### Subscriber writes

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/posts/[id]/like` | — | `{ liked: bool, count: number }` (toggles) |
| `POST` | `/api/posts/[id]/bookmark` | — | `{ bookmarked: bool }` (toggles) |
| `POST` | `/api/posts/[id]/comments` | `{ body: string }` | `{ comment: Comment, status: "PUBLISHED" \| "PENDING" }` |
| `PATCH` | `/api/posts/[id]/comments/[commentId]` | `{ body: string }` | `{ comment }` (author only, within 5 min of `createdAt`) |
| `DELETE` | `/api/posts/[id]/comments/[commentId]` | — | `{ ok: true }` (author only) |

### Admin-only

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/admin/comments/[commentId]/hide` | — | `{ ok: true }` (sets status=HIDDEN, deletedAt=now) |
| `POST` | `/api/admin/comments/[commentId]/restore` | — | `{ ok: true }` (sets status=PUBLISHED, deletedAt=null, recomputes count) |
| `POST` | `/api/admin/comments/[commentId]/approve` | — | `{ ok: true }` (PENDING → PUBLISHED, recomputes count) |
| `PATCH` | `/api/admin/posts/[id]/moderation` | `{ commentsRequireApproval: bool }` | `{ post }` |

### Subscriber pages

| Path | Notes |
|---|---|
| `/bookmarks` | Subscriber-only server component. Lists bookmarked posts newest-first, infinite scroll, identical card style to `/`. Anonymous → redirect to `/welcome?next=/bookmarks`. |

### Comment shape

```ts
type Comment = {
  id: string;
  postId: string;
  body: string;             // "[deleted]" if deletedAt is set
  authorName: string;       // from Subscriber.name
  authorIsMine: boolean;    // current viewer wrote it
  createdAt: string;        // ISO
  editedAt: string | null;  // ISO
  deletedAt: string | null; // ISO; if set, body is "[deleted]"
  status: "PUBLISHED" | "PENDING" | "HIDDEN";
};
```

## Middleware

`src/proxy.ts` does **not** need changes. Engagement page routes (`/p/[id]`, `/`, `/s/[id]`, `/bookmarks`) are existing or new public paths handled by per-page server logic. The write API endpoints do their own session check, mirroring `/api/chat`'s pattern.

`/bookmarks` is a new path that needs subscriber gating — handled in the page's server component (return `redirect('/welcome?next=/bookmarks')` when no subscriber session), not in the proxy. Keeps proxy thin.

## UI surface

### Public

- **`src/app/PublicFeed.tsx`** — replace decorative Like/Comment/Share buttons with `<EngagementBar postId initialLikeCount initialCommentCount initialLiked initialBookmarked />`. Comment button jumps to `/p/[id]#comments`.
- **`src/app/p/[id]/page.tsx`** — under the post body, render `<EngagementBar />`, then `<CommentThread postId initialComments pendingCount />` and `<CommentComposer postId moderated />`. Anonymous visitors see the composer as a disabled CTA "Sign in to comment" linking to `/welcome?next=/p/<id>#comments`.
- **`src/app/bookmarks/page.tsx`** (new) — subscriber-only page. Reuses the feed card components.
- **`src/components/EngagementBar.tsx`** (new) — Like / Bookmark / Comment-jump / Share row. Optimistic toggles for like + bookmark.
- **`src/components/CommentThread.tsx`** (new) — paginated list. Each row: avatar/initial, name, relative time, body (or "[deleted]"), edit/delete kebab if mine, "edited" badge if `editedAt`. "Load more" cursor button at the bottom.
- **`src/components/CommentComposer.tsx`** (new) — textarea (2000 char cap, character counter at 1800+), Post button. Disabled with sign-in CTA when anonymous. After successful post: clears + appends to thread + (if PENDING) shows a small "Awaiting approval" badge on the new comment.
- **`src/components/ShareButton.tsx`** (new) — Web Share API + clipboard fallback + toast.
- **`src/components/SubscriberHeader.tsx`** — add a "Bookmarks" link for subscribers (next to "Sign out"). (Note: PR #55 already extends this component for the anonymous case; this work merges on top.)

### Admin

- **`src/app/admin/comments/page.tsx`** (new) — moderation queue. Filters: `PENDING`, `PUBLISHED`, `HIDDEN`, by post. Bulk approve/hide. Search by author or body substring.
- **`src/app/admin/posts/[id]/page.tsx`** — add a `commentsRequireApproval` toggle (per-post) in the existing settings drawer. Also surface the post's `likeCount` and `commentCount` (read-only, with a "View moderation" link).

## Server modules

New under `src/lib/engagement/`:

- `like.ts` — `toggleLike(postId, subscriberId)` → `{ liked, count }`. Sequential awaits: upsert/delete + recompute `Post.likeCount`.
- `bookmark.ts` — `toggleBookmark(postId, subscriberId)` → `{ bookmarked }`. Same shape, no count.
- `comments.ts` — `createComment`, `editComment`, `deleteComment`, `hideComment`, `restoreComment`, `approveComment`, `listComments`. Encapsulates the moderation status logic and count recompute.
- `rate-limit.ts` — in-memory token bucket: 5 comments / subscriber / minute. Same pattern as `src/lib/subscribers/signin-rate-limit.ts` (single-region Fluid Compute reuses instances, so the in-memory store is sufficient at this scale).

Reconciliation extension:
- `src/lib/readiness-service.ts` (or a sibling) — extend the daily cron to also recompute `likeCount` and `commentCount` for every post. Cheap (two `count(*)` per post; runs once a day; ~1.2k posts).

## Edge cases & rules

- **Toggle race** (subscriber double-taps Like): `upsert` is idempotent; the count recompute reads the current `count(*)` so the final value is correct. Worst case: count drifts by ≤1 between the two requests; daily reconcile fixes it.
- **Comment counts include only `PUBLISHED` and `deletedAt = null`.** PENDING and HIDDEN don't count toward the public number. (PENDING shows separately as "1 awaiting review".)
- **Edit window**: 5 minutes from `createdAt`. After that, edit endpoint returns 403 `{ error: "edit_window_expired" }`. Delete is always allowed for the author.
- **Delete**: sets `deletedAt`, leaves `status` and `body` intact for audit. Public render swaps body → "[deleted]". Decrement `commentCount`.
- **Hide (admin)**: sets `status = HIDDEN`, `deletedAt = now`. Same effect as delete from a public-render perspective. Restore reverses.
- **Approve (admin)**: PENDING → PUBLISHED, increment `commentCount`.
- **Comment length**: 2000 chars max (server- and client-enforced). Empty / whitespace-only rejected. No markdown — render as plain text with client-side URL linkification (regex → `<a target="_blank" rel="noopener noreferrer nofollow">`).
- **Subscriber name change**: not currently supported, but if added later, the `authorName` shown on existing comments updates because it's joined from `Subscriber.name`. (No name snapshot on the comment row.)
- **Subscriber revoke** (`Subscriber.revokedAt`): writes blocked at API; existing likes/bookmarks/comments **stay visible** (Gil keeps the conversation context). Comments still render with the original author name. If we want stronger removal, we can later add a soft-revoke mode that anonymizes to "[former subscriber]".
- **Post deletion / hard-delete**: cascades to all engagement rows via `onDelete: Cascade`. Soft-delete on `Post` (which the codebase already supports) does NOT cascade — likes/bookmarks/comments persist; the engagement bar simply isn't shown because the post is in `/admin/trash`.
- **Bookmark on a no-longer-public post** (admin un-publishes / archives): the `/bookmarks` query joins on `Post`, filtered to the same conditions the public feed uses. Hidden posts silently drop out of the bookmark list (no error).
- **Anonymous Share**: `navigator.share` requires HTTPS. On preview deployments (HTTPS, ✅) and prod (HTTPS, ✅) this is fine. Localhost dev: clipboard fallback always.
- **Concurrent moderation** (admin approves while subscriber edits within window): edit is allowed regardless of status — the status field is admin-controlled, body is author-controlled. They're orthogonal.

## Migration & rollout

### Migration

Per CLAUDE.md, **do not** run `prisma migrate dev`. Sequence:

1. Edit `prisma/schema.prisma` with the additions above (3 new models + 3 new fields on `Post` + 3 new relations on `Subscriber`).
2. `export DATABASE_URL="$POSTGRES_URL_NON_POOLING"` (CLAUDE.md gotcha).
3. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script -o prisma/migrations/<ts>_engagement/migration.sql`
4. `psql "$POSTGRES_URL_NON_POOLING" -f prisma/migrations/<ts>_engagement/migration.sql`
5. `npx prisma migrate resolve --applied <ts>_engagement`
6. `npx prisma generate`

**Backfill**: defaults handle it (`likeCount=0`, `commentCount=0`, `commentsRequireApproval=false`). No data migration needed.

### Rollout sequence

Each phase is its own PR, each independently shippable. Merging a phase doesn't block reverting it (engagement rows persist but go unused if the UI rolls back).

1. **Phase 1 — Likes + Share** (smallest backend, biggest visible win). Migration adds `PostLike` + `Post.likeCount`. UI: real Like toggle + functional Share button. Bookmark/Comment buttons stay decorative or are hidden.
2. **Phase 2 — Bookmarks + `/bookmarks` page.** Migration adds `PostBookmark`. UI: Bookmark icon + new `/bookmarks` route + `SubscriberHeader` link.
3. **Phase 3 — Comments (publish-immediately).** Migration adds `PostComment` + `CommentStatus` + `Post.commentCount` + `Post.commentsRequireApproval` (defaults to false everywhere). UI: thread + composer + edit/delete window + rate limit. Moderation queue ships in Phase 4.
4. **Phase 4 — Comment moderation.** No schema change. UI: `/admin/comments` queue, hide/restore/approve actions, per-post `commentsRequireApproval` toggle in the post detail.
5. **Phase 5 (optional) — Reconciliation cron extension.** No schema change. Extends `/api/cron/readiness` to recompute counts. Can ship anytime after Phase 1 — only matters when drift accumulates. (Drift in practice is rare; this is belt-and-suspenders.)

### Reversibility

- Phases 1–4: revert PR → UI rolls back; engagement rows stay in DB (harmless, no orphan FKs). Counts on `Post` stay at their last-written values.
- Schema rollback (if absolutely necessary): drop `PostLike`, `PostBookmark`, `PostComment`, `CommentStatus` enum, and the three `Post` columns. Generate the down-SQL with `prisma migrate diff` flipped (from new schema to old).

## Testing strategy

- **Unit (vitest)**:
  - `src/lib/engagement/like.test.ts` — toggle in/out of liked state; concurrent toggle behavior; count recompute after each mutation.
  - `src/lib/engagement/bookmark.test.ts` — toggle; uniqueness; subscriber A bookmarking does not affect subscriber B.
  - `src/lib/engagement/comments.test.ts` — create / edit-within-window / edit-after-window-rejected / delete / hide-restore / approve / pending status flow / count recompute including PENDING ignored.
  - `src/lib/engagement/rate-limit.test.ts` — 5 comments allowed, 6th blocked, window resets after 60s (use fake timers).
- **API route tests (vitest, mocked auth + prisma)**:
  - 401 / 403 / 404 paths for every write endpoint.
  - Anonymous can `GET` comments; cannot `POST`.
  - Admin can hide/approve; non-admin gets 403.
- **Manual smoke (UI)** — user handles browser verification per CLAUDE.md "UI Testing" rule. Provide a checklist in the PR body for each phase.

## Open questions / iteration 2

1. **Subscribers only for likes/bookmarks/comments, anonymous for share** — confirm this is the right cut.
2. **Subscriber `name` shown publicly on comments** — Gil knows every subscriber by name, but the names are now on the public archive. Acceptable? Alternative: subscribers pick a public display handle separate from `Subscriber.name` (~1 day extra work).
3. **Default to publish-immediately vs. require-approval** — spec defaults to publish-immediately. If Gil prefers a calmer rollout, we can default `commentsRequireApproval = true` for all existing posts at migration time and let him flip it off per post or globally.
4. **`/bookmarks` URL** — okay, or prefer `/saved` / `/me/bookmarks`?
5. **Subscriber revoke behavior** — keep their content visible (current spec), or anonymize to "[former subscriber]" / hard-delete? (My default: keep visible.)
6. **Share targets** — Web Share API + clipboard only, or also explicit Facebook/X/WhatsApp buttons? (My default: just Web Share + clipboard. Native share sheet on mobile already includes those.)
7. **Notifications to Gil** — out of scope here, but worth noting: cheapest first cut is a daily email summary of new comments via the existing daily-brief cron.
8. **Voice/audio comments** — given Eitan's mobility-aware preference for voice-first UX, should comments support a "record audio" alternative input that gets transcribed? (My default: no for v1; revisit once text comments are landing.)

## Definition of done

- All five phases merged.
- Engagement bar replaces the decorative buttons in `PublicFeed.tsx` and renders on `/p/[id]`.
- Subscribers can like, bookmark, comment, edit (within window), delete, and view their `/bookmarks`.
- Anonymous visitors can share; every other action redirects to `/welcome?next=<original_url>`.
- Admin can moderate from `/admin/comments`, hide / restore / approve, and toggle `commentsRequireApproval` per post.
- Counts on `Post.likeCount` / `Post.commentCount` stay within ±1 of `count(*)` between cron runs; the daily reconcile reduces drift to 0.
- Rate limit prevents > 5 comments / subscriber / minute.
- Type-check + unit tests pass.
- CLAUDE.md updated with the engagement section (mirroring the Subscriber Gate section's depth).
