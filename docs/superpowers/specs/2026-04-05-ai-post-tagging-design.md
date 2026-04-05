# AI Post Tagging — Design Spec

**Date:** 2026-04-05  
**Status:** Approved

## Overview

Automatically analyze imported posts using Claude AI to generate descriptive tags. Tags are stored on the post and enable filtering/search across the CMS.

---

## Data Model

Add `tags String[]` to the `Post` model with a GIN index for fast array queries in PostgreSQL.

```prisma
model Post {
  // ... existing fields ...
  tags  String[]  @default([])

  @@index([tags], type: Gin)
}
```

Tags are lowercase, free-form strings (e.g. `["beach", "sunset", "travel", "people", "golden hour"]`). No predefined categories — Claude decides what's most descriptive.

---

## Analysis API Route

**`POST /api/posts/[id]/analyze`**

Auth-gated to the post owner. Can be called from the import worker or manually in the future.

### Steps

1. Load post + media from DB
2. Build a `claude-sonnet-4-6` messages request:
   - Post body text as a user message
   - All **image** media as inline base64 `image` blocks
   - For **video** media: fetch up to 5 Cloudinary frame thumbnails via URL transformation (`/so_0p/`, `/so_25p/`, `/so_50p/`, `/so_75p/`, `/so_100p/`) and include as `image` blocks — no ffmpeg required
3. Prompt Claude to return a flat JSON array of lowercase tags with maximum descriptive coverage
4. Parse the response and save tags via `prisma.post.update({ data: { tags } })`
5. Return `{ tags: string[] }`

### Error handling

If Claude fails (API error, malformed response), return HTTP 500. Tags remain empty (`[]`). No post data is affected.

### Claude prompt

```
Analyze this social media post and return a JSON array of descriptive lowercase tags.
Include tags for: subjects, objects, scenes, locations, activities, mood, colors, people descriptors, and any other relevant concepts.
Be thorough — aim for 10-20 tags. Return only the JSON array, no explanation.
```

---

## Import Integration

In `import-worker.ts`, after each post is successfully inserted into the DB:

- Fire-and-forget a POST to `/api/posts/${post.id}/analyze` using base URL derived as `process.env.NEXTAUTH_URL ?? \`https://${process.env.VERCEL_URL}\`` — `NEXTAUTH_URL` is set locally, `VERCEL_URL` is auto-injected by Vercel in production/preview
- Use a concurrency limiter (semaphore, max 5 concurrent) to avoid overwhelming the Claude API during large imports
- Tagging failures are silently swallowed — a failed tag does not fail or stall the import

---

## Search & Display

### API

`GET /api/posts?tag=beach` — adds `where: { tags: { has: tag } }` to the Prisma query. The GIN index makes this fast.

### UI

- **Post list (`/posts`)**: Add a search/filter input above the list. Submitting filters by tag. Tags displayed as small badges on each post card.
- **Post detail (`/posts/[id]`)**: Tags displayed as badges in the post metadata area.

---

## Dependencies

- `@anthropic-ai/sdk` — to be added to `package.json`
- `ANTHROPIC_API_KEY` — new environment variable (Vercel + local)
- Cloudinary video thumbnail URL transformations — no new packages, uses existing Cloudinary setup

---

## Out of Scope

- Manual "re-analyze" button (the API route supports it architecturally, but no UI trigger in this iteration)
- Semantic/AI-powered search (embeddings, vector DB) — future feature
- Tag editing by the user — future feature
