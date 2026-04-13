# Cross-Platform Analytics — TODO / Plan

**Status:** Parked. Design agreed, not started. Pick this up when ready.
**Date:** 2026-04-11

## Why this exists

The original `facebook-analytics` feature (see `2026-04-06-facebook-analytics.md`) is broken at the platform level: Meta permanently removed the `user_posts` permission from their Permissions Reference. There is no way to read a personal Facebook profile's timeline from a third-party app in 2026. The `PLATFORM__INVALID_APP_ID` / `Invalid Scopes: user_posts` errors we hit during connection setup are Meta refusing to grant a scope that no longer exists.

On top of that, the retroactive "import from ZIP then discover post ID by timestamp" flow was always going to be fragile. The real pivot: track analytics **forward-looking**, keyed off posts that the CMS itself publishes.

Going forward every post originates in this hub and is pushed out to all platforms. Each publish call returns a platform post ID — we capture it at that moment. Analytics then becomes "given (platform, platformPostId, accessToken), fetch current metrics." No discovery needed.

## Short-term cleanup (prerequisite — do this first, separate PR)

1. **Delete dead Facebook analytics code** — it can never work for personal profiles:
   - `src/lib/platforms/facebook-analytics.ts`
   - `src/lib/platforms/facebook-analytics.test.ts`
   - `src/app/api/cron/facebook-analytics/route.ts`
   - The Facebook cron entry in `vercel.json` (if present)
   - `src/app/api/connections/facebook/route.ts` and `src/app/api/connections/facebook/callback/route.ts`
   - Any Facebook card on `/connections` page
   - `META_APP_ID`/`META_APP_SECRET` stay — Instagram still needs them
2. **Fix the existing Instagram connection** — it's stale vs Meta's current API and vs our own CLAUDE.md:
   - Update scopes from `instagram_basic,instagram_content_publish,instagram_manage_media` → `instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights` (note the `_business_` prefix Meta added in late 2024, AND the new insights scope)
   - Change OAuth URL from `facebook.com/v21.0/dialog/oauth` → `instagram.com/oauth/authorize` (per CLAUDE.md and Instagram Business Login docs)
   - Change redirect URI base from `NEXTAUTH_URL` → `APP_URL` (matches every other connection)
   - Token exchange endpoint should be `graph.instagram.com/access_token` for long-lived tokens (per CLAUDE.md)
   - Update `src/app/api/connections/instagram/callback/route.ts` to match
3. **FB ZIP import stays as-is** — purely an archive of historical content. No analytics expected for these rows. The posts list / detail page should not display "fetch analytics" affordances for posts with no corresponding `PublishRecord`.

## Data model (new)

### Extend `PublishRecord`
```prisma
model PublishRecord {
  // existing fields stay
  latestMetrics     Json?      // normalized shape: { impressions, reach, likes, comments, shares, saves, views, clicks }
  metricsUpdatedAt  DateTime?
  metricsError      String?    // last fetch error, cleared on success
}
```

### New table — time-series history
```prisma
model PublishMetricSnapshot {
  id               String   @id @default(cuid())
  publishRecordId  String
  publishRecord    PublishRecord @relation(fields: [publishRecordId], references: [id], onDelete: Cascade)
  fetchedAt        DateTime @default(now())
  impressions      Int?
  reach            Int?
  likes            Int?
  comments         Int?
  shares           Int?
  saves            Int?     // IG-specific, nullable elsewhere
  views            Int?
  clicks           Int?
  raw              Json     // full platform response — platform-specific extras + debugging
  @@index([publishRecordId, fetchedAt])
}
```

**Why hybrid (latest-on-record + snapshot table):**
- `latestMetrics` on `PublishRecord` makes "show me all posts with their current numbers" a single indexed query with no joins.
- `PublishMetricSnapshot` gives growth curves, trend detection, day-1-vs-day-7 comparisons — only queried when the UI actually asks for history.

**Normalization approach:** common fields as columns (for cross-platform aggregation), full response in `raw: Json` (nothing gets lost, platform-specific metrics surfaced from `raw` in platform-specific UI sections).

## Code layout (new)

```
src/lib/analytics/
  types.ts          // NormalizedMetrics type
  index.ts          // dispatch(platform, accessToken, platformPostId) → NormalizedMetrics
  instagram.ts      // Graph API — /{media-id}/insights, fields reach,impressions,saved,likes,comments,plays,shares,total_interactions
  linkedin.ts       // Social Actions API + share statistics
  tiktok.ts         // Display API /video/list + metrics
  youtube.ts        // YouTube Analytics API
```

Each fetcher is independent. Adding a platform = one new file. Zero cross-platform coupling.

## Refresh cadence

Engagement decays sharply after publish. Age-aware refresh keeps API quotas sane:

| Age since publish | Refresh every |
|---|---|
| < 1 hour | 15 min |
| 1–24 hours | 1 hour |
| 1–7 days | 6 hours |
| 7–30 days | 1 day |
| > 30 days | 1 week |

One cron at `/api/cron/analytics` runs hourly, selects `PublishRecord`s where `publishedAt` exists AND `(metricsUpdatedAt IS NULL OR metricsUpdatedAt < now() - interval(age))`. Fetch in parallel with a concurrency cap (~5). On 429/quota errors: skip, increment `metricsError`, retry next tick.

Add cron entry to `vercel.json` with `CRON_SECRET` auth header (same pattern as existing crons).

## UI

- **Post detail page**: per-platform cards side by side — current metrics per platform, plus an aggregate header ("Total reach: X across N platforms").
- **Sparkline**: tiny 7-day trend chart per platform, sourced from `PublishMetricSnapshot`.
- **Posts list**: optional "performance" column with aggregated reach across all platforms.
- **(Later) Dashboard**: leaderboards, platform breakdown, time-to-peak analysis.

## Token expiry handling

Analytics runs silently in cron — expired tokens become invisible failures. Required:
- `metricsError` field on `PublishRecord` (above) for per-record error state.
- `/connections` page shows "token expired" badge on any platform with failing refresh.
- Consider a `PlatformToken.lastErrorAt` / `lastErrorMessage` column for global visibility across all records for a given connection.

## Platform parity expectations

Not all platforms expose the same data quality:
- **Instagram (Business/Creator)**: excellent — reach, impressions, saves, likes, comments, plays, shares, total_interactions
- **YouTube**: excellent — views, watch time, likes, comments, CTR, impressions (Analytics API is rich)
- **TikTok**: good — views, likes, comments, shares, reach, avg watch time (requires approved Display API app)
- **LinkedIn**: limited for personal profiles — `r_member_social` gives some data, but organizational pages are where the full Page statistics live. Personal post metrics will be sparser than IG/YT.
- **Facebook personal profile**: ❌ no data (Meta API blocks this)
- **Facebook Page**: possible via Pages API if a Page is added to the stack later

Set the UI/empty-state expectations accordingly — "no data available for this platform" is a legitimate state.

## Implementation order (agreed — each step mergeable on its own)

1. **Cleanup PR** — delete dead FB analytics code, fix IG connection (short-term cleanup section above). This unblocks everything and leaves the system in a consistent state.
2. **Schema + first fetcher** — Prisma migration for `PublishRecord` fields + `PublishMetricSnapshot` table. Build `src/lib/analytics/instagram.ts`. Manual test via a script or route.
3. **Cron + basic UI** — `/api/cron/analytics`, vercel.json entry, per-platform card on post detail page showing Instagram metrics. Prove the end-to-end loop.
4. **Add remaining platforms** — TikTok, YouTube, LinkedIn, one PR each. Each adds a fetcher and a UI card; zero impact on existing platforms.
5. **Polish** — sparklines, aggregate header, posts-list performance column, token-expiry badges on `/connections`.
6. **(Optional, later)** — analytics dashboard, retention policy for old snapshots (thin to daily after 90 days).

## Open questions to resolve before step 2

- **LinkedIn**: personal profile vs company page — does user want to publish to a Company Page too? If so we need `w_organization_social` + company URN handling. If personal only, metrics will be thinner.
- **TikTok Research API**: requires approval and an academic/research justification. Display API covers per-video basics for the authenticated creator without that. Confirm the Display API is enough before pursuing Research API.
- **YouTube**: Analytics API quota is 10,000 units/day. Per-video metric call is cheap (~1 unit), so well within budget, but confirm.
- **Instagram media discovery**: for the *very first* sync after the connection is authorized, do we backfill metrics for any existing IG posts the user has (via `/me/media`)? Or only track posts published through the CMS going forward? The cleaner answer is "going forward only" — but some users will want the backfill. Decide explicitly.

## Why FB ZIP archive posts have no metrics

Make sure the UI clearly communicates this so it doesn't look like a bug:
- Imported FB ZIP posts have no `PublishRecord` (they weren't published by the CMS).
- Meta no longer allows reading personal FB timeline via API, so we can't backfill `PublishRecord`s retroactively.
- These posts function as a historical archive for browsing, tagging, AI search, and republishing elsewhere — but their original FB engagement data is gone.

This isn't a limitation of our implementation — it's a platform-level decision by Meta that affects every app.

## Resuming this work

When picking this up, start by re-reading this file, then:
1. Check whether any of the "Open questions" have been answered since (user may have decided LinkedIn scope, IG backfill policy, etc.).
2. Confirm the short-term cleanup PR hasn't already been done — look at `src/lib/platforms/facebook-analytics.ts` existence and `src/app/api/connections/facebook/` directory.
3. Start with step 1 (cleanup) if not done, then step 2.
