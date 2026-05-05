# Engagement Features (Likes / Bookmarks / Comments / Shares) — Design Spec

**Date:** 2026-05-05
**Branch:** `feature/engagement-spec` (spec only); implementation uses phased branches per **Phasing**.
**Status:** Approved — proceed to PR1 implementation.

## Goal

Replace the currently decorative Like / Comment / Share buttons in `src/app/PublicFeed.tsx` with real persisted engagement, and add Bookmark and a flat comment thread on `/p/[id]`. Subscribers can react and discuss; share is friction-free for everyone (including anonymous visitors) so post URLs travel.

The archive itself stays public (per PR #55). Engagement writes are subscriber-only; engagement reads (counts, comment thread) are public.

## Non-goals

- Multi-reaction picker (FB-style ❤️ / 😂 / 😢). Single Like only.
- Threaded / nested comment replies. Flat thread only.
- Notifications to subscribers (replies, likes on their comments, mentions). Defer to v2.
- Email digest to Gil of new comments. **Skipped** (Q7) — Gil checks `/admin/comments` himself.
- Anonymous likes / bookmarks / comments. Subscribers only.
- Share-event tracking / share counts. Web Share / clipboard fire-and-forget.
- Editing or deleting **other** subscribers' content (only own + admin moderation).
- Real-time updates (web sockets / SSE). Counts refresh on next page load or when the user themselves toggles.
- Per-post moderation (`commentsRequireApproval` flag). **Dropped** (Q3) — comments publish immediately; admin can hide after the fact.
- Voice / audio comments (Q8). Text only.

## User stories

1. As a subscriber, I want to like a post so I can express that something resonated, and so Gil can see what lands.
2. As a subscriber, I want to bookmark a post so I can come back to it later from one place.
3. As a subscriber, I want to comment on a post and read what other subscribers have written.
4. As a subscriber, I want to edit my comment whenever (typos noticed days later happen) and delete it whenever.
5. As a subscriber, I want a public display name distinct from the real name Gil knows me by, so my reflections aren't tied to my legal identity on a public archive.
6. As anyone (anonymous or subscriber), I want a Share button so I can copy the post URL to send to a friend.
7. As Gil, I want to see comment counts at a glance, hide a comment without taking the whole thread down, and disable a specific subscriber from commenting if they spam.

## Architecture

### Subscribers, not users

All write surfaces (`like`, `bookmark`, `comments` POST/PATCH/DELETE) require `session.user.role === "subscriber" || "admin"`. Admins can do everything subscribers can plus moderate. Anonymous visitors who tap a write affordance are redirected to `/welcome?next=<original_url>` with a fragment that scrolls back to the action area (`#engagement` or `#comments`) post-login.

### Reads are public

`GET /api/posts/[id]/comments` returns the published comment thread to anyone. Like and comment counts are denormalized onto `Post` (see Data model) and rendered server-side as part of the existing public feed query — no extra round trip per card.

### Optimistic UI

Like and Bookmark toggle instantly client-side and roll back on a non-2xx response. Comments don't optimistic-render the thread (composer clears on success and the new comment is appended from the response payload).

### Counts: denormalized + manual reconcile

`Post.likeCount` and `Post.commentCount` are kept on the `Post` row. Mutations update both the join table and the count column in the same sequential-await chain (no `prisma.$transaction([...])` — pgbouncer transaction-pool mode times out per the CLAUDE.md gotcha).

**No reconcile cron.** The existing daily readiness cron is hard-capped at `take: 200` per run — a 6-day full-coverage cycle for ~1.2k posts, wrong tool. Drift in practice will be tiny. For the rare case it's needed, an admin **"Reconcile engagement counts"** button on `/admin/settings` triggers `POST /api/admin/engagement/reconcile`, which runs **two bulk SQL UPDATEs** (one per count column). Total runtime: milliseconds for 1.2k posts.

### Moderation

**Default policy: comments publish immediately.** No PENDING state, no per-post approval toggle. Admin can:
- **Hide** any comment (soft delete — `status = HIDDEN`, `deletedAt = now`, body retained for audit; rendered as `[deleted]` in the thread).
- **Restore** a hidden comment.
- **Disable a specific subscriber from commenting** via `Subscriber.commentsDisabledAt` toggle (without revoking the whole subscription).

Authors can hard-delete their own comments (`prisma.delete` — row gone, count decrements, thread reflows). No `[deleted]` placeholder for author-deleted; if you delete it, it's gone.

### Display names

Subscribers have a separate `displayName String?` field on `Subscriber`. Render is `displayName ?? name`. Subscribers who have never commented have `displayName = null` and never need to pick one. The first time they post a comment, the composer detects null and shows an inline single-input prompt: "Pick a display name — this is what others see". Save → `displayName` set on the row → comment posts. Deferred: a `/profile` page for changing it later (out of scope for this rollout).

### Edit window

**Unlimited.** No 5-minute or other cap. Server records `editedAt`; client shows a small "edited" badge with hover tooltip of the edit time. Slack / FB convention.

### Share

Pure client-side. `navigator.share({ title, url })` where supported (mobile + Safari/Chrome desktop with HTTPS); clipboard fallback elsewhere with a toast. The native share sheet on mobile already includes Facebook / X / WhatsApp / etc. — no need for explicit per-platform buttons. No server hop, no DB row, no count.

### Count display

- **Like count = 0** → render only the empty heart, no number. (Twitter / Insta convention; "0 likes" or "1 like" discourages early engagement on cold-start posts.)
- **Like count > 0** → render heart + count.
- **Comment count** → always shown, even when 0.

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
  HIDDEN
}

model PostComment {
  id           String        @id @default(cuid())
  postId       String
  subscriberId String
  body         String        @db.Text
  status       CommentStatus @default(PUBLISHED)
  editedAt     DateTime?
  deletedAt    DateTime?     // set when admin HIDDEN; null otherwise
  createdAt    DateTime      @default(now())

  post         Post          @relation(fields: [postId], references: [id], onDelete: Cascade)
  subscriber   Subscriber    @relation(fields: [subscriberId], references: [id], onDelete: Cascade)

  @@index([postId, status, createdAt])
  @@index([status, createdAt])
  @@index([subscriberId, createdAt])
}
```

Additions to existing `Post`:

```prisma
model Post {
  // …existing fields…
  likeCount    Int @default(0)
  commentCount Int @default(0)

  likes      PostLike[]
  bookmarks  PostBookmark[]
  comments   PostComment[]
}
```

Additions to existing `Subscriber`:

```prisma
model Subscriber {
  // …existing fields…
  displayName        String?
  commentsDisabledAt DateTime?

  likes     PostLike[]
  bookmarks PostBookmark[]
  comments  PostComment[]
}
```

**Why three focused tables, not one polymorphic engagements table**: different access patterns (likes are toggles, bookmarks are per-subscriber lists, comments have body + lifecycle). Sharing a table forces null columns and weakens indexes.

**Why `displayName` nullable + lazy first-comment prompt**: subscribers who never comment never need to pick one. Avoids a forced first-sign-in flow.

**Why `commentsDisabledAt` as a timestamp not a boolean**: cheap audit trail — when did Gil disable them.

## API surface

All under `/api/posts/[id]/` unless noted. All return JSON. All write endpoints reject 401 if `!session`, 403 if `subscriber.revokedAt` is set, 404 if the post doesn't exist.

### Public reads

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/posts/[id]/comments?cursor=&limit=20` | `{ comments: Comment[], nextCursor: string \| null }` (only PUBLISHED + non-hidden bodies) |
| `GET` | `/api/me/engagement?postIds=a,b,c` | `{ liked: string[], bookmarked: string[] }` — used by feed/post-detail to render filled-in icons. Returns `{ liked: [], bookmarked: [] }` for anonymous (200 OK, not 401 — UI-only enrichment, avoids per-page-load console noise). |

### Subscriber writes

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/posts/[id]/like` | — | `{ liked: bool, count: number }` (toggles) |
| `POST` | `/api/posts/[id]/bookmark` | — | `{ bookmarked: bool }` (toggles) |
| `POST` | `/api/posts/[id]/comments` | `{ body: string, displayName?: string }` | `{ comment: Comment }` (if `displayName` provided, sets `Subscriber.displayName` first; rejects with 403 if subscriber has `commentsDisabledAt` set) |
| `PATCH` | `/api/posts/[id]/comments/[commentId]` | `{ body: string }` | `{ comment }` (author only, **anytime** — no edit window) |
| `DELETE` | `/api/posts/[id]/comments/[commentId]` | — | `{ ok: true }` (author only — **hard delete**, row gone) |

### Admin-only

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/admin/comments/[commentId]/hide` | — | `{ ok: true }` (status=HIDDEN, deletedAt=now, decrement count) |
| `POST` | `/api/admin/comments/[commentId]/restore` | — | `{ ok: true }` (status=PUBLISHED, deletedAt=null, recompute count) |
| `POST` | `/api/admin/subscribers/[id]/comments-disabled` | `{ disabled: bool }` | `{ subscriber }` (toggles `commentsDisabledAt`) |
| `POST` | `/api/admin/engagement/reconcile` | — | `{ likesUpdated: number, commentsUpdated: number }` (bulk SQL UPDATE) |

### Subscriber pages

| Path | Notes |
|---|---|
| `/bookmarks` | Subscriber-only server component. Lists bookmarked posts newest-first, infinite scroll, identical card style to `/`. Anonymous → redirect to `/welcome?next=/bookmarks`. |

### Comment shape

```ts
type Comment = {
  id: string;
  postId: string;
  body: string;             // "[deleted]" if status === "HIDDEN"
  authorName: string;       // Subscriber.displayName ?? Subscriber.name
  authorIsMine: boolean;    // current viewer wrote it
  createdAt: string;        // ISO
  editedAt: string | null;  // ISO; non-null → "edited" badge
  status: "PUBLISHED" | "HIDDEN";
};
```

## Middleware

`src/proxy.ts` does **not** need changes. Engagement page routes (`/p/[id]`, `/`, `/s/[id]`, `/bookmarks`) are existing or new public paths handled by per-page server logic. Write API endpoints do their own session check, mirroring `/api/chat`'s pattern.

`/bookmarks` gating is handled in the page's server component (return `redirect('/welcome?next=/bookmarks')` when no subscriber session), not in the proxy. Keeps proxy thin.

## UI surface

### Public

- **`src/app/PublicFeed.tsx`** — replace decorative Like/Comment/Share buttons with `<EngagementBar postId initialLikeCount initialCommentCount initialLiked initialBookmarked />`. Comment button jumps to `/p/[id]#comments`.
- **`src/app/p/[id]/page.tsx`** — under post body: `<EngagementBar />`, then `<CommentThread postId initialComments />` and `<CommentComposer postId />`. Anonymous visitors see the composer as a disabled CTA "Sign in to comment" linking to `/welcome?next=/p/<id>#comments`.
- **`src/app/bookmarks/page.tsx`** (new) — subscriber-only page. Reuses the feed card components.
- **`src/components/EngagementBar.tsx`** (new) — Like / Bookmark / Comment-jump / Share row. Optimistic toggles for like + bookmark. Hides "0" on Like.
- **`src/components/CommentThread.tsx`** (new) — paginated list. Each row: avatar/initial, name (`displayName ?? name`), relative time, body (or "[deleted]"), edit/delete kebab if mine, "edited" badge if `editedAt`. "Load more" cursor button at the bottom.
- **`src/components/CommentComposer.tsx`** (new) — textarea (2000 char cap, character counter at 1800+), Post button. **First-comment inline displayName prompt** when subscriber has no `displayName`. Disabled with sign-in CTA when anonymous.
- **`src/components/ShareButton.tsx`** (new) — Web Share API + clipboard fallback + toast.
- **`src/components/SubscriberHeader.tsx`** — add a "Bookmarks" link for subscribers (next to "Sign out"). (Note: PR #55 already extends this component for the anonymous case; this work merges on top.)

### Admin

- **`src/app/admin/comments/page.tsx`** (new) — moderation list. Filters: `PUBLISHED`, `HIDDEN`, by post. Hide / restore actions. No "approve" — there's no PENDING state.
- **`src/app/admin/settings/...`** (existing) — extend the subscribers section with two additions:
  - "Disable comments" toggle column per subscriber row (writes `commentsDisabledAt`)
  - "Reconcile engagement counts" button at the bottom (POSTs to `/api/admin/engagement/reconcile`)

## Server modules

New under `src/lib/engagement/`:

- `like.ts` — `toggleLike(postId, subscriberId)` → `{ liked, count }`. Sequential awaits: upsert/delete + recompute `Post.likeCount`.
- `bookmark.ts` — `toggleBookmark(postId, subscriberId)` → `{ bookmarked }`. Same shape, no count.
- `comments.ts` — `createComment`, `editComment`, `deleteComment` (author hard delete), `hideComment` (admin), `restoreComment` (admin), `listComments`.
- `comment-rate-limit.ts` — `export const commentRateLimiter = createRateLimiter({ maxRequests: 5, windowMs: 60_000 })`. Reuses **`src/lib/rate-limit.ts`** (existing factory, in-memory token bucket).
- `reconcile.ts` — bulk SQL UPDATE for `Post.likeCount` and `Post.commentCount`. Called from the admin button.

## Edge cases & rules

- **Toggle race** (subscriber double-taps Like): `upsert` is idempotent; the count recompute reads the current `count(*)` so the final value is correct. Worst case: count drifts by ≤1 between the two requests; admin can manually reconcile if it ever bothers them.
- **Comment counts include only `PUBLISHED`.** HIDDEN and author-deleted (gone) don't count.
- **Edit anytime** for the author. Server records `editedAt`; client shows "edited" badge with tooltip.
- **Author delete = hard delete**: `prisma.delete`. Row gone, count decrements, thread reflows.
- **Hide (admin)**: sets `status = HIDDEN`, `deletedAt = now`. Body retained for audit. Restore reverses.
- **Comment length**: 2000 chars max. Empty / whitespace-only rejected. No markdown — render as plain text with client-side URL linkification (regex → `<a target="_blank" rel="noopener noreferrer nofollow">`).
- **Rate limit**: 5 comments / subscriber / minute (in-memory `commentRateLimiter`).
- **`commentsDisabledAt` enforcement**: server rejects POST `/comments` with 403 `{ error: "comments_disabled" }` when set.
- **Subscriber name change**: not currently supported (no `/profile` page yet). When it lands, `authorName` shown on existing comments updates because it's joined from `Subscriber.displayName ?? Subscriber.name`.
- **Subscriber revoke** (`Subscriber.revokedAt`): writes blocked at API; existing likes/bookmarks/comments **stay visible** (Q5).
- **Post deletion / hard-delete**: cascades to all engagement rows via `onDelete: Cascade`. Soft-delete on `Post` (which the codebase already supports) does NOT cascade — engagement persists; the bar simply isn't shown because the post is in `/admin/trash`.
- **Bookmark on a no-longer-public post**: the `/bookmarks` query joins on `Post`, filtered the same way the public feed is. Hidden posts silently drop out of the bookmark list.
- **Anonymous Share**: `navigator.share` requires HTTPS. Preview deployments + prod ✅. Localhost dev: clipboard fallback always.

## Migration & rollout

### Migration

Per CLAUDE.md, **do not** run `prisma migrate dev`. Sequence per PR's schema additions:

1. Edit `prisma/schema.prisma`.
2. `export DATABASE_URL="$POSTGRES_URL_NON_POOLING"` (CLAUDE.md gotcha).
3. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script -o prisma/migrations/<ts>_<name>/migration.sql`
4. `psql "$POSTGRES_URL_NON_POOLING" -f prisma/migrations/<ts>_<name>/migration.sql`
5. `npx prisma migrate resolve --applied <ts>_<name>`
6. `npx prisma generate`

**Backfill**: defaults handle it. No data migration needed.

### Phasing — 3 PRs

Each phase is its own PR, each independently shippable.

1. **PR1 — Likes + Bookmarks + Share + `/bookmarks` page.** Migration adds `PostLike` + `PostBookmark` + `Post.likeCount`. UI: real Like toggle + Bookmark toggle + functional Share button + `/bookmarks` route + `SubscriberHeader` link. No Comment infra yet.
2. **PR2 — Comments.** Migration adds `PostComment` + `CommentStatus { PUBLISHED, HIDDEN }` + `Post.commentCount` + `Subscriber.displayName` + `Subscriber.commentsDisabledAt`. UI: thread + composer + edit-anytime + hard-delete + first-comment displayName prompt + rate limit. Admin moderation UI ships in PR3.
3. **PR3 — Admin moderation + reconcile.** No schema change. UI: `/admin/comments` queue with hide/restore, `commentsDisabledAt` toggle in subscriber list, "Reconcile engagement counts" button.

### Reversibility

- PR1–3: revert PR → UI rolls back; engagement rows stay in DB (harmless). Counts on `Post` stay at their last-written values.
- Schema rollback: drop the new tables/enum/columns. Generate down-SQL with `prisma migrate diff` flipped.

## Testing strategy

- **Unit (vitest)**:
  - `src/lib/engagement/like.test.ts` — toggle in/out; concurrent toggle behavior; count recompute.
  - `src/lib/engagement/bookmark.test.ts` — toggle; uniqueness; per-subscriber isolation.
  - `src/lib/engagement/comments.test.ts` — create / edit-anytime / hard-delete by author / hide-restore by admin / `displayName` fallback / count recompute.
  - `src/lib/engagement/comment-rate-limit.test.ts` — 5 allowed, 6th blocked, window resets after 60s (fake timers).
  - `src/lib/engagement/reconcile.test.ts` — seed mismatched counts, run reconcile, assert all match `count(*)`.
- **API route tests (vitest, mocked auth + prisma)**:
  - 401 / 403 / 404 paths for every write endpoint.
  - Anonymous can `GET` comments and `GET /api/me/engagement`; cannot `POST`.
  - Admin can hide/restore/reconcile; non-admin gets 403.
  - `commentsDisabledAt` blocks POST `/comments` with 403.
- **Manual smoke (UI)** — user handles browser verification per CLAUDE.md "UI Testing" rule. Per-PR checklist in PR description.

## Definition of done

- All three PRs merged.
- Engagement bar replaces decorative buttons in `PublicFeed.tsx` and renders on `/p/[id]`.
- Subscribers can like, bookmark, comment, edit anytime, hard-delete, set/show a separate display name, and view their `/bookmarks`.
- Anonymous visitors can share; every other action redirects to `/welcome?next=<original_url>`.
- Admin can moderate from `/admin/comments` (hide/restore), disable a subscriber's commenting from `/admin/settings`, and manually reconcile counts.
- Counts on `Post.likeCount` / `Post.commentCount` stay accurate via in-mutation recompute; manual reconcile button is the safety valve.
- Rate limit prevents > 5 comments / subscriber / minute.
- Type-check + unit tests pass.
- CLAUDE.md updated with the engagement section (mirroring the Subscriber Gate section's depth).
