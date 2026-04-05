# Create Post Page — Design Spec

**Date:** 2026-04-05  
**Status:** Approved

## Overview

A new page at `/posts/new` that lets users manually create a post with text body, optional media attachments (images/videos), and an optional date. After creation the user is redirected to the post detail page.

## Route & Page Structure

- **Path:** `src/app/(dashboard)/posts/new/page.tsx`
- **Type:** Client component (needs React state for form + file upload progress)
- The posts list already links to `/posts/new` via the "New Post" button — no change needed there.

### Page sections

1. **Content** — textarea for post body (required; inline validation error if empty on submit)
2. **Media** — file picker (click or drag-and-drop), shows previews before upload:
   - Images: thumbnail preview
   - Videos: file icon + filename
   - Each file has a remove button
3. **Date** — `datetime-local` input defaulting to the current time; user may change it (optional)
4. **Submit button** — "Create Post"; disabled during submission; shows inline progress ("Uploading media 2/3...")

## API Design

### Existing: `POST /api/posts`

No changes. Already accepts `{ text, originalDate }`, returns created post with `id`.

### New: `POST /api/posts/[id]/media`

**File:** `src/app/api/posts/[id]/media/route.ts`

Handles two upload paths determined by the client:

| Path | When | Request format |
|------|------|----------------|
| Direct | File < 4 MB | `multipart/form-data` with `file` field |
| Blob | File ≥ 4 MB | `application/json` with `{ blobUrl, filename, mimeType }` |

Server behaviour:
1. Verify session + post ownership
2. For blob path: fetch file from Vercel Blob URL, then delete the blob
3. Upload buffer to Cloudinary via `uploadBuffer(key, buffer, mimeType)` using `mediaKey(userId, filename)` for the storage key
4. Create `Media` record: `{ postId, storageKey, mimeType, sizeBytes }`
5. Return `{ ok: true }`

## Upload Flow (client-side)

On submit:

1. Validate body is non-empty
2. `POST /api/posts` → receive `postId`
3. For each selected file (in parallel):
   - If `file.size < 4 * 1024 * 1024`: POST `multipart/form-data` to `/api/posts/[postId]/media`
   - Else: client-side upload to Vercel Blob (`/api/blob`) → POST blob URL to `/api/posts/[postId]/media`
4. If any media upload fails: show error toast, still redirect (post text is saved)
5. `router.push(/posts/[postId])`

Progress UI updates after each file completes: "Uploading media (N/total)..."

## Accepted File Types

```
image/jpeg, image/png, image/gif, image/webp, image/heic,
video/mp4, video/quicktime
```

Corresponds to `accept` attribute on the file input and server-side MIME validation.

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Empty body | Inline error, no submission |
| Post creation fails | Show error, stay on page |
| One media upload fails | Show toast error, continue redirect |
| All media uploads fail | Show toast error, still redirect to post |

## Files Changed / Created

| File | Change |
|------|--------|
| `src/app/(dashboard)/posts/new/page.tsx` | New — create post form |
| `src/app/api/posts/[id]/media/route.ts` | New — media attachment endpoint |
