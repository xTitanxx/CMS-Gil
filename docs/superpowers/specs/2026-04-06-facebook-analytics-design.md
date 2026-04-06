# Facebook Analytics — Design Spec
**Date:** 2026-04-06  
**Status:** Approved

## Overview

Pull post performance metrics (reactions, comments, shares, and Professional Mode reach/impressions) from the Facebook Graph API for posts that were imported from Facebook. Data is refreshed nightly via cron. Displayed on post detail pages and summarised on post list cards.

## Context & Constraints

- Posts imported from Facebook have `source: FACEBOOK` and a `sourceId` of `fb_{timestamp}` or `fb_photo_{filename}` — these are **synthetic IDs**, not real Facebook post IDs. The export format does not include actual post IDs.
- The cron job must therefore run a **discovery pass** first: paginate the Graph API to match imported posts to real Facebook post IDs by `originalDate` timestamp.
- The user's Facebook profile is in **Professional Mode**, which enables `read_insights` and may expose reach/impressions at the post level. These metrics are gracefully optional — stored as null if the API does not return them.
- Facebook tokens expire every ~60 days and must be manually renewed via the Connections page.
- Existing `META_APP_ID` / `META_APP_SECRET` env vars are reused — no new credentials needed.

## Section 1: Data Model

### Schema changes

**Add `FACEBOOK` to the `Platform` enum:**
```prisma
enum Platform {
  FACEBOOK
  INSTAGRAM
  LINKEDIN
  YOUTUBE
  TIKTOK
}
```

**New `PostAnalytics` model:**
```prisma
model PostAnalytics {
  id             String   @id @default(cuid())
  postId         String
  post           Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  platform       Platform

  platformPostId String?  // real FB post ID once discovered (e.g. "123456_789012")
  reactions      Int?
  comments       Int?
  shares         Int?
  reach          Int?     // unique accounts reached — Professional Mode only, may be null
  impressions    Int?     // total views — Professional Mode only, may be null

  fetchedAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@unique([postId, platform])
  @@index([postId])
}
```

**Add relation to `Post`:**
```prisma
analytics PostAnalytics[]
```

### Migration
Standard Prisma migration (`npx prisma migrate dev`).

## Section 2: Facebook OAuth Connection

### New routes
- `GET /api/connections/facebook` — builds Facebook Login OAuth URL and redirects
  - Endpoint: `https://www.facebook.com/v21.0/dialog/oauth`
  - Scopes: `public_profile,user_posts,read_insights`
  - State: `session.user.id`
- `GET /api/connections/facebook/callback` — handles the OAuth callback
  - Exchanges code for short-lived token
  - Exchanges short-lived token for long-lived token (~60 days) via `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token`
  - Fetches `platformUserId` from `/me?fields=id,name`
  - Upserts `PlatformToken` record with `platform: FACEBOOK`
  - Redirects to `/connections?success=facebook`

### Connections page
Add a Facebook card to the existing platform list:
- Label: "Facebook"
- Description: "Connect your Facebook profile to enable post analytics."
- Shows connected username and token expiry date
- Reconnect button (token expires every 60 days)

### Environment variables
No new variables — reuses `META_APP_ID` and `META_APP_SECRET`.

## Section 3: Analytics Fetching Library

**File:** `src/lib/platforms/facebook-analytics.ts`

### `discoverFacebookPostId(accessToken, originalDate, sourceId): Promise<string | null>`

Finds the real Facebook post ID for an imported post by matching on timestamp.

- If `sourceId.startsWith('fb_photo_')`: paginates `GET /me/photos?fields=id,created_time` 
- Otherwise: paginates `GET /me/posts?fields=id,created_time`
- Matches where `Math.abs(new Date(created_time) - originalDate) < 60_000` (1 minute tolerance)
- Returns the Facebook post ID string, or `null` if not found within reasonable pagination depth (5 pages / 500 posts)

### `fetchPostInsights(accessToken, fbPostId): Promise<AnalyticsResult>`

Fetches metrics for a known post ID. Makes two parallel Graph API calls:

1. `GET /{fbPostId}?fields=reactions.summary(true),comments.summary(true),shares`
2. `GET /{fbPostId}/insights?metric=post_impressions,post_impressions_unique`

Returns:
```ts
interface AnalyticsResult {
  reactions: number | null
  comments: number | null
  shares: number | null
  reach: number | null        // from post_impressions_unique
  impressions: number | null  // from post_impressions
}
```

Both calls are wrapped in try/catch — if insights returns an error (e.g. not available for this post type), those fields are null and the other call's data is still used.

## Section 4: Cron Job

**File:** `src/app/api/cron/facebook-analytics/route.ts`

**Schedule:** Daily at 3am (`0 3 * * *`) — added to `vercel.json` alongside existing cron jobs.

**Auth:** `Authorization: Bearer <CRON_SECRET>` (same pattern as existing crons).

### Logic per run

```
For each user with an active FACEBOOK PlatformToken:
  1. Load all posts where source=FACEBOOK and sourceId IS NOT NULL
  2. Discovery pass:
     - Filter to posts with no PostAnalytics record OR platformPostId=null
     - Call discoverFacebookPostId() for each
     - Upsert PostAnalytics with platformPostId (no metrics yet)
  3. Insights pass:
     - Filter to posts with PostAnalytics.platformPostId IS NOT NULL
     - Cap at 50 posts per user per run (prioritise least-recently-updated)
     - Call fetchPostInsights() for each
     - Upsert PostAnalytics metrics + updatedAt
```

Rate limiting: 50 posts/user/run stays well within Facebook's Graph API limits. Posts not reached in a given run are picked up the next day.

## Section 5: UI

### Post detail page

A new "Analytics" panel rendered as a server component (consistent with how the detail page already works — direct Prisma fetch, no client-side API call). Panel is only shown when `post.source === 'FACEBOOK'`.

**States:**
- **No analytics record yet:** "Analytics pending — syncs nightly at 3am"
- **Analytics record exists but `platformPostId` is null:** "Post not yet matched — syncs nightly at 3am"
- **Metrics available:** Grid of metric cards

**Metric grid:**
```
[ Reactions ]  [ Comments ]  [ Shares ]
[ Reach* ]     [ Impressions* ]

* shown only if non-null (Professional Mode)
Last updated: Apr 5, 2026 at 3:02am
```

### Post list cards

For Facebook posts with analytics data, show a compact engagement line beneath the post body:

```
❤ 12   💬 3   ↗ 1
```

Nothing shown if no analytics data exists — no empty states or zeros cluttering the list.

## Error Handling

- If the Facebook token is expired/invalid during cron: log the error, skip that user, continue with others
- If `discoverFacebookPostId` returns null: leave `platformPostId` as null; cron retries indefinitely each night until a match is found (or post simply isn't accessible via API)
- If `fetchPostInsights` call 2 (insights) fails: store null for reach/impressions, still save reactions/comments/shares from call 1

## Out of Scope

- Automatic token refresh (Facebook long-lived tokens cannot be refreshed programmatically once expired — user must reconnect)
- Historical analytics trending / charts
- Analytics for posts published *to* Facebook (not yet a posting platform in this CMS)
- Bulk manual refresh UI
