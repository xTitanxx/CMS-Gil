# Stories Feature — Design Spec

## Overview

Separate Facebook Stories from regular posts in the public archive. Stories get a Facebook-style horizontal row of circular thumbnails at the top of `/`, with a full-screen auto-advancing viewer when opened.

## Story Identification

Stories are distinguished by `Post.sourceId` starting with `fb_story_` (already set by the Facebook parser at `src/lib/facebook-parser.ts`). Non-story posts have `sourceId` starting with `fb_` (or `null` for manual posts).

Helper: `src/lib/public-posts.ts` gets a new `isStory(post)` function and queries are split into `getPublicFeedPage()` (posts only, excluding stories) and `getPublicStoriesPage()` (stories only).

## Backend

### Filtering

- `getPublicFeedPage()` — add `NOT: { sourceId: { startsWith: "fb_story_" } }` to the where clause
- `getPublicStoriesPage(cursor?)` — new function, `where: { sourceId: { startsWith: "fb_story_" } }`, ordered by `originalDate` desc, 30 per page, same cursor pagination pattern

### Individual Story Fetch

- `getPublicStory(id)` — like `getPublicPost` but only returns it if it's a story (sourceId starts with `fb_story_`)

### API Endpoints

- `GET /api/public/stories?cursorDate=...&cursorId=...` — paginated list of stories with signed media URLs (30 per page)
- Individual stories are rendered by the `/s/[id]` server component directly (no dedicated API needed)

### Dedup

Stories are NOT deduped by `bodyNormalized` — they typically have no body and are unique media posts. The `dedupePosts` function already handles empty `bodyNormalized` correctly (passes them through unchanged).

## Frontend

### Stories Row (on `/`)

- **Horizontal scrollable strip** at the top of the feed, between the header and the posts list
- Each story: **circular thumbnail** (~64px diameter) showing the first media item's thumbnail, with a colored ring border
- Row scrolls horizontally (CSS `overflow-x-auto`)
- Initial load: 30 stories (SSR into page)
- Lazy-load more stories as user scrolls the row horizontally via IntersectionObserver on a trailing sentinel
- Click a thumbnail → opens full-screen viewer starting at that story's index

### Full-Screen Story Viewer

**Layout:**
- Fixed-position full-screen overlay, black background
- Top: thin progress bars (one segment per story in the session), the active one fills over time
- Top-right: close (×) button
- Top-left: story date overlay in white text
- Center: story media (image or video, scaled to fit)
- Bottom/sides: tap zones (no visible UI)

**Behavior:**
- Opens at the clicked story's index, with access to all loaded stories (for navigation)
- **Images**: auto-advance after 5 seconds
- **Videos**: auto-advance when video ends; videos autoplay muted
- **Tap right third** of screen → next story; if last story, close viewer
- **Tap left third** → previous story; if first, stay on first
- **Tap middle** or close button → close
- **Keyboard**: ArrowRight/Space = next, ArrowLeft = previous, Esc = close
- **Shareable URL**: viewer updates `window.history.replaceState` to `/s/[id]` as user navigates, so the URL reflects the current story without adding history entries (so closing still goes back to `/`)

### Standalone Story Page `/s/[id]`

- Server component that renders the viewer directly (no feed behind it), with just this story loaded
- Used when someone opens a shared story link
- "Close" button navigates to `/` (since there's no feed history)

### Story Card Thumbnails

- First media item's signed URL used as thumbnail
- For videos, we use the video URL directly in an `<img>` tag with a poster/thumbnail, OR just render a small `<video>` element without controls showing the first frame via `preload="metadata"`
- Fallback: if media URL fails, skip rendering that story (they'll be rare)

## UI Details

### Stories Row Styling

- Gap between thumbnails: ~12px
- Horizontal padding to match feed column width
- Subtle scrollbar hidden (overflow-x-auto but scrollbar-width: none)
- Each circle: 64px × 64px, rounded-full, 2px blue border, overflow-hidden

### Viewer Styling

- Background: pure black (`bg-black`)
- Progress bars: top 4px tall strip, 4px gap between segments, active fills from left-to-right, dim white for completed, semi-transparent for future
- Date overlay: `text-white text-sm` at top-left, small drop shadow for legibility
- Media: `object-contain` so full media is visible (no cropping), max 100vh

## Environment

No new env vars. Uses existing `GIL_USER_ID`.

## Future Considerations

- "Seen" state persistence (so the ring turns gray after viewing) — requires client-side storage or auth
- Story reactions/comments
- Story grouping by date (e.g., "Today", "Last week")
- Prev/next story preloading for smoother transitions
