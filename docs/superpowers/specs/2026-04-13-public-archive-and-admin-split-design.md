# Public Archive + Admin Split — Design Spec

## Overview

Split the app into two experiences:
- **Public**: scrollable social-feed-style archive of Gil's posts at `/`, with shareable individual post pages at `/p/[id]`, and the Gil chatbot at `/chat`.
- **Admin**: all existing content-management routes move under `/admin/*`, behind Google OAuth (unchanged auth).

This lays the foundation for the eventual `gilalter.com` public site + `gilalter.com/admin` CMS.

## Architecture

### Public Routes (no auth)

- **`/`** — scrollable feed of all Gil's posts, deduped, infinite scroll (20 posts/page), newest first. Each post shows date, body, and media only.
- **`/p/[id]`** — individual post page showing one post plus a "Related posts" section (3-5 posts sharing tags). Includes a "← Back to feed" button.
- **`/chat`** — existing Gil chatbot (unchanged).

### Admin Routes (behind auth, under `/admin/*`)

- **`/admin`** — redirects to `/admin/dashboard`
- **`/admin/dashboard`**, **`/admin/posts`**, **`/admin/posts/[id]`**, **`/admin/posts/new`**, **`/admin/import`**, **`/admin/connections`**, **`/admin/scheduled`**, **`/admin/todo`**, **`/admin/trash`**, **`/admin/trash/[dir]`**, **`/admin/trash/[dir]/post/[postId]`** — all existing dashboard pages

### Folder Migration

- Rename `src/app/(dashboard)/` → `src/app/admin/` (regular folder, not route group — this changes the URL prefix)
- The existing `layout.tsx` inside moves with it; auth check and sidebar continue to work unchanged
- Create new `src/app/admin/page.tsx` that redirects to `/admin/dashboard`

### Public Post Loading

- Posts are loaded using the same `GIL_USER_ID` env var already used by the chatbot
- Two new API endpoints:
  - `GET /api/public/feed?cursor=<id>` — returns a page of 20 deduped posts
  - No individual post API needed — the `/p/[id]` page is a server component that queries Prisma directly
- Both endpoints are public (no auth check)

### Deduplication

- For each group of posts sharing the same `bodyNormalized`, keep only the **oldest** (smallest `originalDate`) — treats it as the original; reposts are hidden
- Posts with empty/null `bodyNormalized` (rare) are shown as-is (not deduped)
- Implemented in the query layer — the public feed API only returns deduped posts

### Infinite Scroll

- Client-side component uses `IntersectionObserver` to load the next page when the bottom of the feed is visible
- Cursor-based pagination using `originalDate` + `id` as a compound cursor

### Related Posts

- On `/p/[id]`, find 3-5 posts with overlapping tags (most tag overlap first, excluding the current post), then fall back to date proximity if no tag overlap
- Server-side query in the page component

## UI Design

### Public Feed (`/`)

- Narrow centered column (max-width ~600-700px, like Twitter/Facebook feed)
- Simple header: Gil's name + avatar at the top
- Each post: card with date, body, and media inline
- Cards are clickable to navigate to `/p/[id]`
- Loading indicator at the bottom while fetching next page
- End-of-feed message when no more posts

### Individual Post (`/p/[id]`)

- Same centered column width
- "← Back to feed" link at the top (uses browser back if history is available, else links to `/`)
- Full post: date, body, media
- "Related posts" heading below
- 3-5 related post cards (same visual as feed items), each clickable

### Media Display

- Images: full-width within the column, native aspect ratio
- Videos: native HTML5 video player
- Multiple media items displayed vertically (simple stack)

## Admin Changes

### Route Moves

All current `(dashboard)` routes move under `/admin/*`. The folder rename handles this automatically — Next.js route groups with parentheses don't contribute to the URL, but a plain folder name does.

### Link Updates

Every reference to `/dashboard`, `/posts`, `/import`, `/connections`, `/scheduled`, `/todo`, `/trash` in page code needs to be updated to the `/admin/*` equivalent:
- Sidebar navigation links
- `signIn` callbackUrl values
- Redirects in server components
- `router.push` calls
- `href` attributes in `Link` components
- Query string `?from=` values

API routes under `/api/*` are **not** changed.

### Login Changes

- Remove the LinkedIn sign-in button from `src/app/(auth)/login/SignInButtons.tsx` (Google is the only sign-in method)
- Update `callbackUrl` from `/dashboard` to `/admin/dashboard`
- Update `redirect()` in `src/app/page.tsx` — if authenticated, redirect to `/admin/dashboard`; otherwise, render the public feed

### Root Page Logic

`src/app/page.tsx` currently redirects everyone to `/dashboard`. New behavior: always render the public feed. Authenticated admins can navigate to `/admin` manually (or we can add a small "Admin" link in the footer that only appears for authenticated users).

## Deletion / Cleanup

- Keep LinkedIn platform connection code (connections page, publishing) as-is — only the login button is removed.
- No other code deletion needed.

## Environment Variables

No new env vars required. `GIL_USER_ID` is already set from the chatbot work.

## Future Considerations

- Tag-based filtering on the feed (click a tag to see all posts with that tag)
- SEO: open graph tags for `/p/[id]` pages so shared links preview nicely
- Analytics: track page views on public pages
- RSS feed of posts
- Domain split: eventually gilalter.com serves the public routes, gilalter.com/admin the admin
