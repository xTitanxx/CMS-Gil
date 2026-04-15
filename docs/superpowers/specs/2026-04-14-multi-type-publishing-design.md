# Multi-Type Publishing Design

**Date:** 2026-04-14
**Status:** Draft
**Phase:** 1 of 2 (Phase 2: AI evergreen/ephemeral classifier — separate spec)

## Problem

The publish system treats all content as regular posts. Facebook and Instagram support three distinct formats (Post, Reel, Story) with different API endpoints, reach characteristics, and lifespans. The system should respect the creator's intent for each piece of content.

## Data Model

### New enum and field

```prisma
enum PostType {
  POST
  REEL
  STORY
}

model Post {
  ...
  postType  PostType @default(POST)
}
```

`postType` is a property of the content itself, not per-platform. One field drives publishing behavior across all platforms.

### Migration & Backfill

1. Add `PostType` enum and `Post.postType` field (default `POST`)
2. Backfill from existing `fb:` tags:
   - `fb:reel` → `REEL`
   - `fb:story` → `STORY`
   - all others → `POST` (default)
3. Remove all `fb:post`, `fb:reel`, `fb:story` values from `Post.tags` arrays
4. Update all code that reads `fb:` tags to read `postType` instead (query filters, badge display, kind tabs)

## Platform Publishing Matrix

| postType | FB Page | Instagram | TikTok | YouTube | LinkedIn |
|----------|---------|-----------|--------|---------|----------|
| **POST** | Feed post | Post (carousel if multi-media) | Video | Video (Short if vertical ≤60s) | Post (multi-image if multi-media) |
| **REEL** | Reel (`/video_reels`) | Reel | Video | Short (if ≤60s, else regular video) | Post |
| **STORY** | Story (`/stories`) | Story (`media_type: "STORIES"`) | Video | Video (Short if vertical ≤60s) | Post |

### Key rules

- **Carousel** is automatic when a POST has multiple media files. Not a postType.
- **YouTube Shorts**: append `#Shorts` to description when video is vertical and ≤60 seconds. Applies to all postTypes with qualifying video.
- **TikTok**: always uploads as video regardless of postType. Requires video media.
- **LinkedIn**: always publishes as a regular post regardless of postType. Supports multi-image.

## Platform-Specific Changes

### Instagram (`src/lib/platforms/instagram.ts`)

Current behavior: all single videos auto-publish as Reels.

Changes:
- **POST + single video**: publish as regular video post (not Reel)
- **POST + single image**: publish as image post (unchanged)
- **POST + multi-media**: publish as carousel (unchanged)
- **REEL**: publish as Reel via `media_type: "REELS"` (current behavior for videos)
- **STORY**: publish via `media_type: "STORIES"` endpoint (new)

### Facebook Page (`src/lib/platforms/facebook.ts`)

Current behavior: all content publishes as regular feed posts.

Changes:
- **POST**: unchanged (feed post, multi-photo supported)
- **REEL**: use `/video_reels` endpoint instead of `/videos`
- **STORY**: use Page Stories endpoint (`/photo_stories` or `/video_stories`)

### TikTok (`src/lib/platforms/tiktok.ts`)

No changes. Always uploads video.

### YouTube (`src/lib/platforms/youtube.ts`)

Change: detect vertical video ≤60s and append `#Shorts` to description. No postType-specific logic beyond this.

### LinkedIn (`src/lib/platforms/linkedin.ts`)

No changes. Always publishes as a UGC post.

## UI Changes

### Post detail / editor

Add a `postType` selector — segmented control with three options: Post / Reel / Story. Displayed near the top of the post detail page. Changing it saves immediately via the existing PATCH endpoint.

### Post list badge

Currently reads `fb:post` / `fb:reel` / `fb:story` tags to show "FACEBOOK POST", "FACEBOOK REEL", "FACEBOOK STORY" in the badge. Switch to reading `postType` field. Badge shows source + type, e.g. "FACEBOOK REEL".

### Kind tabs (Posts / Stories)

Currently filters by `fb:story` tag. Switch to filter by `postType` field:
- Posts tab: `postType` is `POST` or `REEL`
- Stories tab: `postType` is `STORY`

### PublishPanel

No changes. The `postType` on the post determines the publish format automatically. No per-platform type picker needed.

## API Changes

### PATCH `/api/posts/[id]`

Accept `postType` in the request body. Validate it's a valid `PostType` enum value.

### GET `/api/posts`

Replace `fb:` tag-based kind filtering with `postType` field filtering. Update `kindCounts` to query by `postType` instead of tags.

## Scope Exclusions

- **AI-driven postType classification** (evergreen vs ephemeral) — Phase 2, separate spec
- **Instagram Highlights** — manual action on Instagram, no API support
- **YouTube Community Posts** — requires 500+ subscribers, not applicable yet
- **Facebook personal profile publishing** — Meta API restriction, unchanged (manual copy/download flow)
