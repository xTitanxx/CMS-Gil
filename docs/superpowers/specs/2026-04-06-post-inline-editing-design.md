# Post Inline Editing — Design Spec

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Every post detail page (`/posts/[id]`) becomes always-editable. All fields — body, original date, tags, and media — are editable inline with no mode toggle. Changes auto-save via a debounced API call.

## Architecture

`page.tsx` remains a server component. It fetches the post (including media with signed Cloudinary URLs) and passes the data as props to a new `PostEditor` client component. The static Content, Tags, and Media cards are removed from `page.tsx` and replaced by `<PostEditor>`.

`PostInteractions.tsx` is unchanged — `DeleteButton`, `ReanalyzeButton`, and `PublishPanelWithRefresh` remain as-is.

## PostEditor Component

**Location:** `src/app/(dashboard)/posts/[id]/PostEditor.tsx`

**Props:** initial `body`, `originalDate`, `tags`, `media` (with URLs) from the server component.

**State:** local copies of all four fields.

**Auto-save:** A `useEffect` with an 800ms debounce watches `body`, `originalDate`, and `tags`. On fire, it calls `PATCH /api/posts/[id]` with all three fields. Save status cycles through `idle → saving → saved / error`. A small indicator (e.g., "Saved" with a checkmark, or "Error saving") appears in the Content card header.

**Fields:**

- **Body** — `<textarea>` that auto-resizes to content height. Replaces the static `<p>`.
- **Original date** — `<input type="datetime-local">` rendered at the top of `PostEditor`, above the body. The static formatted date span currently in `page.tsx`'s header row is removed; `PostEditor` owns the date display entirely.
- **Tags** — rendered as removable pills (each with an `×` button). A text input at the end lets the user type and press Enter to add a new tag. Changes update local state and trigger the debounce.
- **Media** — existing items shown in a grid, each with an `×` overlay button to delete immediately. A dropzone below the grid allows uploading new files. Media operations are immediate (no debounce).

## API Changes

### `PATCH /api/posts/[id]`
Add `tags` as an updatable field alongside the existing `body` and `originalDate`:
```ts
...(body.tags !== undefined ? { tags: body.tags } : {}),
```

### `DELETE /api/posts/[id]/media/[mediaId]` (new route)
- Verify the `Media` record exists and belongs to the authenticated user's post.
- Delete the file from Cloudinary via `deleteObject(storageKey, mimeType)`.
- Delete the `Media` record from the DB.
- Returns `{ ok: true }` on success.

No changes needed to `POST /api/posts/[id]/media` — the existing upload endpoint handles both small (multipart) and large (Vercel Blob) files and is reused as-is.

## Error Handling

- Auto-save failures: show "Error saving" in the indicator. Do not discard local state — the user can keep editing and it will retry on the next change.
- Media delete failures: show an inline error below the media grid; leave the item visible.
- Media upload failures: show an inline error; remove the failed upload preview.

## Testing

- Unit: debounce logic (ensure rapid edits collapse into one PATCH call).
- Integration: PATCH with `tags`, DELETE media endpoint (ownership check, Cloudinary delete, DB delete).
- Manual: edit each field, confirm "Saved" appears; add/remove a tag; upload a new media file; delete a media file.
