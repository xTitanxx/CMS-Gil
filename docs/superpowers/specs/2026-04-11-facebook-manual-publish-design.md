# Facebook Publish — Design

**Date:** 2026-04-11
**Status:** Approved for implementation

## Problem

The app publishes to Instagram, LinkedIn, YouTube, and TikTok, but Facebook has no publish target. Two distinct Facebook destinations matter to the user:

1. **Personal profile** — where most of the user's existing content lives. Meta's Graph API has not allowed publishing to personal profiles since 2018, and Professional Mode does not change that (verified against Meta v25 docs: `/me/feed` is read-only for create/update/delete). No API path exists.
2. **Facebook Page** — the user admins a Page. `pages_manage_posts` allows full API publishing of text, photo, and video posts via `POST /{page-id}/feed`, `/photos`, `/videos`.

We want both destinations surfaced in the publish UI, with personal-profile posting handled by a **manual copy-to-clipboard** fallback and Page posting handled by a real API flow alongside IG/LinkedIn/YT/TikTok.

## Goal

- Expose a manual Facebook (Personal) row in the publish surface that copies the caption to the clipboard, with a hover tooltip explaining why it's manual.
- Add an API-backed Facebook Page publish path: new OAuth scopes on the existing `/api/connections/facebook` flow, a new `FACEBOOK_PAGE` platform token, a `postToFacebook` implementation, and a toggleable row in the publish panel wired through the existing dispatcher.

## Non-goals

- Facebook Groups publishing. Out of scope.
- Multiple-page support. If the user admins several pages, we store and publish to the first one returned by `/me/accounts`. Multi-page picker is a later concern.
- Facebook Stories or Facebook Reels endpoints (`/photo_stories`, `/video_stories`, `/video_reels`). Plain feed posts only. A post-type picker is a Phase 2 spec.
- Changes to the existing analytics cron — it continues reading from the personal profile via the `FACEBOOK` token, unchanged.
- Scheduling via Facebook's native `scheduled_publish_time`. We keep scheduling inside our own `PublishRecord` + cron flow, same as IG/LinkedIn, so all platforms share one scheduling model.

## Architecture overview

Two independent pieces of work, shipped together:

```
┌──────────────────────────────────────────────────────────────┐
│ PublishPanel                                                 │
│                                                              │
│  [ Instagram ] (toggle)                                      │
│  [ LinkedIn  ] (toggle)                                      │
│  [ YouTube   ] (toggle)                                      │
│  [ TikTok    ] (toggle)                                      │
│  [ Facebook Page ] (toggle, NEW — API backed)                │
│                                                              │
│  ── manual ─────────────────────────────────                 │
│  [ Facebook (Personal)  [Manual] (?) ]    [ Copy caption ]   │
└──────────────────────────────────────────────────────────────┘
```

Manual Facebook is a non-selectable action row that does not participate in "Post Now". Facebook Page behaves identically to the other toggleable platforms: it enters the selected set, creates a `PublishRecord`, and goes through `publishNow()` → `postToFacebook()`.

## Part 1 — Manual Facebook (Personal)

### UI

A dedicated action row in `src/components/posts/PublishPanel.tsx`, rendered below the toggleable platforms group but inside the same "Select Platforms" section so it reads as part of the list.

Row contents:
- `Facebook (Personal)` label, blue brand color (`text-blue-700`).
- Small `Manual` badge to distinguish from toggle rows.
- `?` icon button with tooltip (see below).
- Right-aligned `Copy caption` button that flips to `Copied!` for ~2 s after a successful copy, then resets.

### Tooltip

No `Tooltip` primitive exists in `src/components/ui/`. Build a lightweight Tailwind-only tooltip inline: a positioned `<span>` revealed via `group-hover` and `focus-within` on the parent button so both mouse and keyboard users see it. A full Radix tooltip is overkill for a single `?`.

Tooltip copy:
> Meta's Graph API doesn't allow publishing to personal Facebook profiles, even in Professional Mode. Copy the caption and paste it into the Facebook app to post.

### Behavior

Purely client-side: `await navigator.clipboard.writeText(body)`. No backend route, no `PublishRecord`, no entry in the dispatcher `switch`. `FACEBOOK` never enters the toggleable `PLATFORMS` array.

### Data flow

`PublishPanel` currently receives `postId` and `hasVideo`. Add a `body: string` prop. The post detail page (`src/app/(dashboard)/posts/[id]/page.tsx`) is a server component that already fetches the post from Prisma, so it passes `post.body` in directly. No new API call.

### Edge cases

- **Empty body.** Captions can legitimately be empty on imported Facebook posts. Show a subtle "No caption — this post has no text" hint next to the button; the Copy button is disabled in that case.
- **Clipboard API unavailable.** Production is HTTPS and dev is localhost (both secure contexts). Guard with a feature check; if unavailable, surface a small inline "Copy not supported in this browser" message. No execCommand fallback.
- **Re-click during Copied! state.** Re-click resets the 2 s timer rather than double-flipping.

## Part 2 — Facebook Page API publish

### Platform enum

Add `FACEBOOK_PAGE` to the `Platform` enum in `prisma/schema.prisma`:

```prisma
enum Platform {
  FACEBOOK
  FACEBOOK_PAGE   // ← new
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
}
```

New Prisma migration: `prisma/migrations/<timestamp>_add_facebook_page_platform/`.

Rationale for a separate enum value rather than overloading `FACEBOOK`:

- `FACEBOOK` already holds a personal-profile **user** access token scoped for analytics (`read_insights`). The Page access token is a different token with different scopes and different lifetime semantics.
- Two separate `PlatformToken` rows keeps the analytics cron (`src/lib/platforms/facebook-analytics.ts`, `src/app/api/cron/facebook-analytics/route.ts`) untouched.
- Aligns with how we already model YouTube separately from other Google-backed flows.

### OAuth flow

The existing `src/app/api/connections/facebook/route.ts` is extended (not replaced) so one click gets both tokens:

- Scopes become: `public_profile,user_posts,read_insights,pages_show_list,pages_read_engagement,pages_manage_posts,pages_manage_engagement`.
- `pages_manage_engagement` is included so future features (likes, comments, reply-from-CMS) don't require another re-auth. It's the same consent screen either way.

### Callback

`src/app/api/connections/facebook/callback/route.ts` is extended:

1. Exchange code for short-lived token (unchanged).
2. Exchange for long-lived user token (unchanged).
3. Store personal user token in `FACEBOOK` PlatformToken row (unchanged, minus the now-wider `scopes` string).
4. **New:** Call `GET https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token={user_token}`.
5. If the response contains at least one page, take the first page:
   - `platformUserId = page.id`
   - `platformUsername = page.name`
   - `accessToken = encrypt(page.access_token)` — page access tokens derived from a long-lived user token are themselves long-lived and typically do not expire, so `expiresAt` is set to `null`.
   - Upsert into a `FACEBOOK_PAGE` `PlatformToken` row.
6. If the user admins zero pages, skip step 5 cleanly and still redirect with `?success=facebook`. The Page publish row simply won't light up as connected.

Multi-page users: we deliberately take only the first page for now. If this becomes a problem, a follow-up adds a chooser.

### `postToFacebook`

New file `src/lib/platforms/facebook.ts` exporting `postToFacebook`, matching the signature shape used by `postToInstagram`, `postToLinkedIn`, etc.:

```ts
export async function postToFacebook(
  creds: { accessToken: string; platformUserId: string }, // page access token + page id
  body: string,
  mediaKeys: string[]
): Promise<{ platformPostId: string; platformUrl?: string }>
```

Behavior:

| Media | Endpoint | Payload |
|---|---|---|
| 0 media | `POST /{page-id}/feed` | `message=body`, `published=true` |
| 1 photo | `POST /{page-id}/photos` | `url=signed_media_url`, `caption=body`, `published=true` |
| 1 video | `POST /{page-id}/videos` | `file_url=signed_media_url`, `description=body` |
| N photos | `POST /{page-id}/photos` (per photo with `published=false`), then `POST /{page-id}/feed` with `attached_media[]` referencing the media ids | "Multi-photo feed post" pattern |
| N videos, or mixed photo+video | Fall back to **one post per media file** rather than introducing half-supported edge cases. The first post carries the caption; subsequent posts carry the media only. This is a compromise to keep the implementation small. Documented in a comment. |

All endpoints require the page access token passed as `access_token` query param or form field. Content-Type is `application/x-www-form-urlencoded` (Graph API's default). `published=true` publishes immediately. The response contains `id` (post id). The canonical URL pattern is `https://www.facebook.com/{page-id}/posts/{numeric_post_id}` — we can construct `platformUrl` from the returned id.

Text-only feed posts are allowed on pages (unlike Instagram) so no minimum-media guard is needed.

`getSignedDownloadUrl(mediaKey, 3600)` is used to produce the URL passed to Graph API, same pattern as Instagram.

### Dispatcher wiring

`src/app/api/posts/[id]/publish/route.ts:107` — add a `FACEBOOK_PAGE` case to the `switch`:

```ts
case "FACEBOOK_PAGE":
  result = await postToFacebook(
    { accessToken, platformUserId: platformUserId! },
    post.body,
    mediaKeys
  );
  break;
```

No special handling — it follows the same `PlatformToken` lookup path as Instagram.

### PublishPanel wiring

Add `FACEBOOK_PAGE` to the toggleable `PLATFORMS` const and the `PLATFORM_COLORS` map. Displayed label: `Facebook Page`. Color: blue brand palette (`bg-blue-50 border-blue-200 text-blue-700`). It is **not** in `VIDEO_ONLY_PLATFORMS` — pages accept text, photo, or video.

### Connections page

`src/app/(dashboard)/connections/page.tsx` currently has one Facebook card with analytics wording. Keep it as **one card, not two** — there is a single OAuth consent for both the personal-profile analytics token and the Page publish token, so splitting the card would misrepresent that as two separate connections.

The Facebook card shows both facets:

- Description updated to mention both analytics and Page publishing, plus a one-liner that personal profiles are manual-only.
- When connected, it surfaces both bits of state: `@{personal_profile_name}` and, if a page was linked, `Page: @{page_name}`. If the user admins zero pages, it shows `No pages found — publishing unavailable` in place of the page line, so the failure mode is legible without breaking the rest of the connection.
- A single `Disconnect` button removes both rows (see cascade below).

### Disconnect cascade

`src/app/api/connections/route.ts` DELETE handler currently removes a single `(userId, platform)` row. Extend it so that when `platform=FACEBOOK` is requested, it also removes the `FACEBOOK_PAGE` row in the same query:

```ts
await prisma.platformToken.deleteMany({
  where: {
    userId: session.user.id,
    platform: platform === "FACEBOOK"
      ? { in: ["FACEBOOK", "FACEBOOK_PAGE"] }
      : platform,
  },
});
```

This keeps the cascade server-side and atomic, rather than relying on the frontend to fire two DELETE calls. `FACEBOOK_PAGE` can also be deleted on its own (e.g., if we later add a "disconnect page only" affordance) without affecting `FACEBOOK`.

## Files touched

**Manual flow (Part 1):**
1. `src/components/posts/PublishPanel.tsx` — add the manual Facebook row + tooltip + copy handler. Accept new `body` prop.
2. `src/app/(dashboard)/posts/[id]/page.tsx` — pass `post.body` to `<PublishPanel>`.

**Page API flow (Part 2):**
3. `prisma/schema.prisma` — add `FACEBOOK_PAGE` to `Platform` enum.
4. New Prisma migration directory.
5. `src/app/api/connections/facebook/route.ts` — expand OAuth scopes.
6. `src/app/api/connections/facebook/callback/route.ts` — fetch `/me/accounts`, upsert the `FACEBOOK_PAGE` token row.
7. `src/lib/platforms/facebook.ts` — new `postToFacebook` function.
8. `src/app/api/posts/[id]/publish/route.ts` — add `FACEBOOK_PAGE` case to the dispatcher switch, import `postToFacebook`.
9. `src/components/posts/PublishPanel.tsx` — add `FACEBOOK_PAGE` to `PLATFORMS` const + color map.
10. `src/app/(dashboard)/connections/page.tsx` — update the single Facebook card to surface both personal analytics and Page publishing state.
11. `src/app/api/connections/route.ts` — extend DELETE handler to cascade `FACEBOOK` → `FACEBOOK_PAGE`.

No changes to:
- `src/lib/platforms/facebook-analytics.ts`
- `src/app/api/cron/facebook-analytics/route.ts`
- `src/lib/auth.ts`
- `ENCRYPTION_KEY` handling (page token is encrypted by the existing `encrypt()` helper)

## Testing

All manual — no unit tests. The repo does not currently test UI with vitest and adding that here is out of scope.

**Manual flow**
- Post with non-empty body → Copy → paste → verify exact caption lands. Check the "Copied!" state flips and reverts after ~2 s.
- Post with empty body → Copy button disabled and hint visible.
- Hover `?` → tooltip appears. Tab to `?` via keyboard → tooltip appears. Tab away → it disappears.
- Toggleable rows still toggle independently; Facebook (Personal) is not selectable and does not participate in "Post Now".

**Page API flow**
- Run the migration locally.
- Click "Connect" on Facebook — Meta consent screen shows the broader scopes (`pages_manage_posts`, etc.). Approve. `FACEBOOK` and `FACEBOOK_PAGE` rows both present in the DB. `platformUsername` on the `FACEBOOK_PAGE` row matches the actual page name.
- On the connections page, both cards show Connected.
- Create a test post with a body only → select Facebook Page → Post Now → verify post appears on the page (check `/{page-id}/posts`).
- Create a test post with a single photo → publish → verify photo post with caption.
- Create a test post with a single video → publish → verify video post.
- Create a test post with two photos → publish → verify multi-photo feed post.
- Disconnect Facebook → verify both `FACEBOOK` and `FACEBOOK_PAGE` rows are gone (cascade in the DELETE handler).
- Zero-page account: log in with a FB account that admins no pages → OAuth completes, `FACEBOOK_PAGE` row absent, Facebook Page card shows "Not connected" gracefully.

## Risks and known unknowns

- **Page access token expiry.** Page tokens derived from long-lived user tokens are long-lived ("do not expire" per Meta docs, but in practice can be invalidated if the user changes their password or revokes the app). We store `expiresAt=null` and let the publish call surface a clear error if the token is dead. No proactive refresh.
- **Video upload via `file_url`.** Graph API's `POST /{page-id}/videos` accepts `file_url` (Meta pulls the video from a URL). The URL must be publicly accessible for the duration of the pull. Cloudinary signed URLs are public for the `expires` window (we pass 3600 s = 1 hour); Meta usually pulls within seconds. Very large videos could in theory exceed this window; if so, we will need to switch to the chunked upload API (`upload_phase=start/transfer/finish`). Out of scope for v1.
- **Multi-photo post ordering.** The `attached_media[]` parameter ordering is respected by Graph API per docs. If visual order matches upload order in practice, we're fine. If not, iterate after we observe a real post.
