# Spec: Posts navigation — feed view, infinite scroll, prev/next

## Goal

Make browsing and reviewing posts fast and fluid. Today the only way to move between posts is to click into a detail page and back out to the list, which is friction-heavy. This spec introduces three coordinated changes:

1. A new **Feed view** on `/posts` (Facebook News Feed style) with **infinite scroll**
2. The existing list view is preserved as an alternative, selectable via a view toggle
3. When viewing a post detail page, **prev/next navigation** (buttons, arrow keys, swipe) that respects the current filter and sort

## Branch

`feature/posts-navigation`

## Non-goals

- Virtualization of the feed (react-window / tanstack-virtual). Flag as a future optimization if scrolling stutters past a few thousand cards. Do not build upfront.
- Rewriting the list view's pagination to cursor-based. The list keeps its existing offset pagination.
- Changing the mobile layout substantially beyond the touch gestures added here.

---

## Part 1 — View toggle on `/posts`

### Behavior

A `List | Feed` switcher is added to the top of the posts page. Selection is persisted in the URL as `?view=list` (default) or `?view=feed`. All other query params (filters, tags, sort, `?silent=true` from the silent-video feature) continue to work identically in both views — both views render the same data, just styled differently.

### Implementation

- Add a small client component `ViewToggle` that reads/writes the `view` search param via `useSearchParams` + `router.push`.
- Inside `src/app/(dashboard)/posts/page.tsx`, branch on `searchParams.view`:
  - If `view === "feed"`, render the new `<PostsFeed />` component.
  - Otherwise, render the existing list UI unchanged.
- The toggle sits in the page header area, next to the existing filter controls.

---

## Part 2 — Feed view with infinite scroll

### Layout

Each post is rendered as a stacked wide card, following the Facebook News Feed formula:

1. Header row: original date (formatted nicely), source badge (MANUAL / IMPORTED / etc.), an "Edit" link to `/posts/[id]`
2. Body text (full, not truncated)
3. Media gallery — full-width inside the card. Videos autoplay muted on scroll-into-view (or play on click — pick whichever is cheaper; muted autoplay is nicer but can be deferred).
4. Tags as pills
5. Any action buttons currently present on the list row

Cards are separated by generous vertical spacing (~24px). The feed column is width-constrained to around `max-w-2xl` so reading flow stays comfortable on wide monitors.

### Data fetching — cursor-based pagination

The feed uses cursor-based pagination instead of offset. This matters because new posts imported mid-scroll would shift offsets and cause duplicates/gaps in an infinite-scroll UI. Cursors are immune to inserts.

**Cursor shape:** `{ originalDate: string (ISO), id: string }` — composite so ties on `originalDate` are deterministic.

**API change:** `/api/posts` accepts a new `cursor` query param. When present, the Prisma where clause becomes:

```ts
where: {
  ...existingFilters,
  OR: [
    { originalDate: { lt: cursor.originalDate } },
    {
      originalDate: cursor.originalDate,
      id: { lt: cursor.id },
    },
  ],
},
orderBy: [
  { originalDate: "desc" },
  { id: "desc" },
],
take: 20,
```

The API response includes `nextCursor` (the composite of the last returned row) or `null` if the page is the last.

Encode the cursor as a base64-encoded JSON string in the query param to keep the URL tidy: `?cursor=eyJvcmlnaW5hbERhdGUiOi...`.

**Important:** existing list-view callers of `/api/posts` that still use `page`/`pageSize` must continue to work. Cursor mode activates only when `cursor` is present. Do not remove offset support.

### Infinite scroll mechanics

Client component `PostsFeed`:

- Holds `posts: Post[]` and `cursor: string | null` in state.
- On mount, fetches page 1 with current filter params (no cursor).
- Renders a sentinel `<div ref={sentinelRef}>` at the bottom of the rendered cards.
- An `IntersectionObserver` watches the sentinel; when it intersects and no fetch is in flight, it fires the next request with the current cursor.
- Appends returned posts to state and updates the cursor.
- Shows a skeleton loader under the last card while a fetch is in flight.
- Shows an "End of feed" marker when the API returns `nextCursor: null`.
- Guards against double-fires with an `isLoading` ref.

### Scroll restoration

When navigating from feed → post detail → back, the user should return to the same scroll position.

Next.js App Router's default `router.back()` handles this in most cases, but infinite-scroll feeds sometimes lose state because the intermediate fetches aren't replayed.

**Fallback if default behavior misbehaves:** cache `{ posts, cursor, scrollY }` in a module-level `Map` keyed by the current query string, restore it on mount. Test in both directions (detail → back → same scroll position).

---

## Part 3 — Prev/next on the detail page

### Behavior

When viewing `/posts/[id]`, the user can move to the previous or next post in the current filtered/sorted set via:

- Visible chevron buttons in a sticky header bar on the detail page
- Keyboard arrow keys: `←` for prev, `→` for next, `Escape` to return to the list
- Swipe gestures on touch screens: horizontal swipe with delta > 60px

Prev/next **respect the filters and sort that were active when the user clicked in from the list**. Example: if the user filtered to silent videos, prev/next stays within silent videos.

### How filter state reaches the detail page

When the list view links to a post, it appends the current query string to the URL:

```
/posts/abc?sort=date-desc&tags=travel&silent=true&from=list
```

The detail page (server component) reads these params via the `searchParams` prop and uses them to compute neighbors.

### Computing prev/next (server-side)

In `src/app/(dashboard)/posts/[id]/page.tsx`, after fetching the current post:

1. Build the same `where` clause and `orderBy` that the list view would use for the current `searchParams`. Factor this into a shared helper (`buildPostsQuery(searchParams, userId)`) so the list view and detail view stay in sync.
2. Query the previous post:
   ```ts
   const prev = await prisma.post.findFirst({
     where: { ...sharedWhere, originalDate: { gt: current.originalDate } },
     orderBy: { originalDate: "asc" },
     select: { id: true },
   });
   ```
3. Query the next post:
   ```ts
   const next = await prisma.post.findFirst({
     where: { ...sharedWhere, originalDate: { lt: current.originalDate } },
     orderBy: { originalDate: "desc" },
     select: { id: true },
   });
   ```

Both queries are `O(log n)` on the `(userId, originalDate)` index. Near-free.

**Edge case:** if `originalDate` ties are possible within the user's posts, tiebreak on `id` the same way the cursor pagination does. Without this, two posts with identical timestamps could "stick" and refuse to advance.

### Rendering prev/next

- Sticky top bar on the detail page with `<` and `>` chevron buttons.
- Each button is a Next.js `<Link>` whose `href` preserves the query string so the chain keeps working:
  ```tsx
  <Link href={`/posts/${prev.id}?${searchParams.toString()}`}>...</Link>
  ```
- When `prev` or `next` is null, render the button disabled (greyed, not clickable, `aria-disabled`).
- A "back to list" link in the same bar that returns to `/posts?${searchParams.toString()}` minus the `from=list` marker.

### Keyboard and touch nav

Add a small client component `PostNavKeys` that mounts alongside the detail page and:

- Attaches a `keydown` listener on `window`:
  - `ArrowLeft` → `router.push(prevHref)` if prev exists
  - `ArrowRight` → `router.push(nextHref)` if next exists
  - `Escape` → `router.push(listHref)`
- Guards against firing when focus is inside an `<input>`, `<textarea>`, or `[contenteditable]` element (check `document.activeElement.tagName`).
- Attaches `touchstart` / `touchend` listeners on the main content container to detect horizontal swipes. If `|deltaX| > 60` and `|deltaY| < 40` (so vertical scrolls don't trigger), navigate accordingly.
- Cleans up all listeners on unmount.

No dependencies required — raw event listeners are fine. Do not pull in `react-swipeable` or similar.

---

## Test plan

### View toggle
- [ ] `/posts` defaults to list view
- [ ] Clicking Feed switches to feed and URL reflects `?view=feed`
- [ ] Applying a filter in list view, then switching to feed, preserves the filter
- [ ] Deep-linking to `/posts?view=feed&tags=travel` loads the feed with the filter applied

### Feed view + infinite scroll
- [ ] Initial load shows first 20 posts
- [ ] Scrolling to the bottom loads the next 20 without duplicates
- [ ] Loading skeleton appears during fetches
- [ ] Reaching the end of the feed shows an "End of feed" marker
- [ ] Filters (tags, sort, silent-only) produce correct results in feed view
- [ ] Importing a new post (or simulating one in DB) and reloading mid-scroll does not produce duplicates or gaps
- [ ] Clicking into a post and pressing back restores scroll position

### Prev/next on detail
- [ ] Clicking a post from the list opens the detail page with prev/next buttons
- [ ] Arrow keys navigate between posts
- [ ] Escape returns to the list at the correct scroll position
- [ ] With a filter active (e.g. `?tags=travel`), prev/next only cycles through matching posts
- [ ] At the boundary (first or last post in the filtered set), the respective button is disabled
- [ ] Swipe gestures work on a narrow browser window or touch device
- [ ] Typing in the body editor or tag input does NOT accidentally navigate on arrow keys

### Regressions
- [ ] List view still works unchanged (pagination, multi-select, filters)
- [ ] `/api/posts` still accepts `page`/`pageSize` for existing callers
- [ ] `npm run build` succeeds
- [ ] `npm test` passes

## Gotchas to watch

- **Shared query helper:** the `buildPostsQuery` helper must be used by both list and detail/prev-next, otherwise prev/next will drift out of sync with the list whenever a filter is added.
- **Keyboard guard:** easy to forget, high annoyance if missed — arrow keys stealing focus from a tag input will make the user hate the feature.
- **Cursor tiebreak:** if you skip the `id` tiebreak on identical `originalDate` values, pagination can stall.
- **Cloudinary video autoplay:** if you go the muted-autoplay route in the feed, confirm it works on iOS Safari (requires `muted` + `playsInline` attributes).
