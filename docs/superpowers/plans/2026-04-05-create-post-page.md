# Create Post Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/posts/new` page that lets users create a post with text, optional media (images/videos), and an optional date, then redirects to the new post's detail page.

**Architecture:** Two-phase submit: (1) create the post record via existing `POST /api/posts`, (2) upload each media file individually via a new `POST /api/posts/[id]/media` endpoint that handles both small files (< 4 MB direct) and large files (≥ 4 MB via Vercel Blob). The create page uses `react-dropzone` (already installed) for file picking.

**Tech Stack:** Next.js App Router, React 19, Prisma, Cloudinary (`uploadBuffer`/`mediaKey` from `src/lib/storage.ts`), `@vercel/blob/client` (`upload`), `react-dropzone`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/app/api/blob/route.ts` | Modify | Add image/video MIME types to `allowedContentTypes` |
| `src/app/api/posts/[id]/media/route.ts` | Create | Accept a file (direct or blob URL), upload to Cloudinary, create `Media` DB record |
| `src/app/(dashboard)/posts/new/page.tsx` | Create | Create post form: body, date, file picker, submit flow |

---

## Task 1: Allow media MIME types on the Vercel Blob token endpoint

**Files:**
- Modify: `src/app/api/blob/route.ts`

The Vercel Blob client SDK calls `/api/blob` to get an upload token. Currently only ZIP/JSON types are allowed. Large image/video uploads will be rejected unless we add media MIME types here.

- [ ] **Step 1: Update `allowedContentTypes` in `src/app/api/blob/route.ts`**

Replace the `onBeforeGenerateToken` body so it reads:

```typescript
onBeforeGenerateToken: async () => {
  return {
    allowedContentTypes: [
      "application/zip",
      "application/x-zip-compressed",
      "application/json",
      "application/octet-stream",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/heic",
      "image/heif",
      "video/mp4",
      "video/quicktime",
    ],
    maximumSizeInBytes: 500 * 1024 * 1024, // 500 MB
  };
},
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd ~/Documents/Code\ Projects/CMS-Gil
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/blob/route.ts
git commit -m "feat: allow image/video MIME types on Vercel Blob token endpoint"
```

---

## Task 2: Create the media attachment API route

**Files:**
- Create: `src/app/api/posts/[id]/media/route.ts`

This endpoint attaches a single media file to an existing post. It handles two request shapes:
- `multipart/form-data` with a `file` field — for files the client sent directly (< 4 MB)
- `application/json` with `{ blobUrl, filename, mimeType }` — for large files the client uploaded to Vercel Blob first

- [ ] **Step 1: Create `src/app/api/posts/[id]/media/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { del } from "@vercel/blob";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: session.user.id },
  });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let buffer: Buffer;
  let filename: string;
  let mimeType: string;

  if (contentType.includes("application/json")) {
    // Large file: client uploaded to Vercel Blob, sends us the URL
    const body = await req.json();
    filename = body.filename as string;
    mimeType = body.mimeType as string;

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const blobUrl = body.blobUrl as string;
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch file from blob storage" }, { status: 500 });
    }
    buffer = Buffer.from(await response.arrayBuffer());
    await del(blobUrl).catch(() => {});
  } else {
    // Small file: sent directly as multipart/form-data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    filename = file.name;
    mimeType = file.type;

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    buffer = Buffer.from(await file.arrayBuffer());
  }

  const storageKey = mediaKey(session.user.id, filename);
  await uploadBuffer(storageKey, buffer, mimeType);

  const media = await prisma.media.create({
    data: {
      postId,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
    },
  });

  return NextResponse.json(media, { status: 201 });
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test — auth guard**

Start the dev server (`npm run dev`). In a private/incognito browser window (not signed in), run:

```bash
curl -X POST http://localhost:3000/api/posts/fake-id/media \
  -H "Content-Type: application/json" \
  -d '{"blobUrl":"http://example.com","filename":"test.jpg","mimeType":"image/jpeg"}'
```

Expected response: `{"error":"Unauthorized"}` with status 401.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/posts/[id]/media/route.ts
git commit -m "feat: add POST /api/posts/[id]/media endpoint for media attachment"
```

---

## Task 3: Build the create post page

**Files:**
- Create: `src/app/(dashboard)/posts/new/page.tsx`

This is a client component with three sections (content, media, date) and a two-phase submit handler. It uses `react-dropzone` for the file picker (same as the import page) and `upload` from `@vercel/blob/client` for large files.

- [ ] **Step 1: Create `src/app/(dashboard)/posts/new/page.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, X, Film, Upload } from "lucide-react";
import Link from "next/link";

const ACCEPTED_MIME_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
};

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

interface SelectedFile {
  file: File;
  preview: string | null; // object URL for images, null for videos
}

function toDatetimeLocal(d: Date): string {
  // Produces "YYYY-MM-DDTHH:mm" in local time for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewPostPage() {
  const router = useRouter();

  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [date, setDate] = useState(() => toDatetimeLocal(new Date()));
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    const next: SelectedFile[] = accepted.map((file) => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    multiple: true,
  });

  function removeFile(index: number) {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  }

  async function uploadMediaFile(postId: string, selected: SelectedFile): Promise<void> {
    const { file } = selected;

    if (file.size < DIRECT_UPLOAD_LIMIT) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/posts/${postId}/media`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
    } else {
      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob",
      });
      const res = await fetch(`/api/posts/${postId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobUrl: blob.url,
          filename: file.name,
          mimeType: file.type,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!body.trim()) {
      setBodyError("Post content is required.");
      return;
    }
    setBodyError("");
    setSubmitting(true);
    setError(null);

    // Phase 1: Create the post
    const postRes = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: body.trim(),
        originalDate: new Date(date).toISOString(),
      }),
    });

    if (!postRes.ok) {
      setError("Failed to create post. Please try again.");
      setSubmitting(false);
      return;
    }

    const post = await postRes.json();
    const postId: string = post.id;

    // Phase 2: Upload media files
    if (files.length > 0) {
      let completed = 0;
      const failedCount = { value: 0 };
      setProgress(`Uploading media (0/${files.length})...`);

      await Promise.all(
        files.map(async (selected) => {
          try {
            await uploadMediaFile(postId, selected);
          } catch {
            failedCount.value++;
          } finally {
            completed++;
            setProgress(`Uploading media (${completed}/${files.length})...`);
          }
        })
      );

      if (failedCount.value > 0) {
        setError(
          `${failedCount.value} file${failedCount.value === 1 ? "" : "s"} failed to upload. The post was still created.`
        );
      }
    }

    router.push(`/posts/${postId}`);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/posts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Post</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Content */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setBodyError("");
              }}
              placeholder="What's on your mind?"
              rows={5}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
            />
            {bodyError && (
              <p className="mt-1 text-xs text-red-600">{bodyError}</p>
            )}
          </CardContent>
        </Card>

        {/* Media */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Media</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              {...getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center transition-colors ${
                isDragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-6 w-6 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">
                {isDragActive ? "Drop files here" : "Click or drag files here"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Images (JPG, PNG, GIF, WebP, HEIC) and videos (MP4, MOV)
              </p>
            </div>

            {files.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {files.map((selected, i) => (
                  <div
                    key={i}
                    className="relative aspect-square overflow-hidden rounded-lg bg-gray-100"
                  >
                    {selected.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selected.preview}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center p-2">
                        <Film className="h-6 w-6 text-gray-400" />
                        <span className="mt-1 text-center text-xs text-gray-500 line-clamp-2">
                          {selected.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Date */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </CardContent>
        </Card>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? (progress ?? "Creating...") : "Create Post"}
          </Button>
          <Link href="/posts">
            <Button type="button" variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test — empty body validation**

In the browser at `http://localhost:3000/posts/new`:
1. Leave the body textarea empty
2. Click "Create Post"

Expected: inline red error message "Post content is required." appears below the textarea. No network request is made.

- [ ] **Step 4: Manual smoke test — text-only post creation**

1. Type some text in the body textarea
2. Click "Create Post"

Expected:
- Button shows "Creating..." while submitting
- Browser navigates to `/posts/[new-id]`
- Post detail page shows the text you typed and the correct date

- [ ] **Step 5: Manual smoke test — post with images**

1. Type some text
2. Click the dropzone and pick 2–3 image files (JPEG/PNG)

Expected: thumbnail previews appear in a grid below the dropzone, each with an X button.

3. Remove one file by clicking its X button

Expected: that preview disappears; others remain.

4. Click "Create Post"

Expected:
- Button cycles through "Uploading media (1/2)...", "Uploading media (2/2)..."
- Navigates to the post detail page
- Media section shows the uploaded images

- [ ] **Step 6: Manual smoke test — post with video**

1. Type some text
2. Drag a `.mp4` or `.mov` file onto the dropzone

Expected: a video tile appears showing the Film icon and filename (not a broken image).

3. Submit

Expected: navigates to post detail; video plays in the media section.

- [ ] **Step 7: Commit**

```bash
git add src/app/(dashboard)/posts/new/page.tsx
git commit -m "feat: add create post page with text, media upload, and date"
```

---

## Self-Review Checklist

- Spec: Route at `/posts/new` ✅ | Multi-file upload ✅ | Image+video types ✅ | Date defaults to now ✅ | Redirect to post detail ✅
- Error handling: empty body inline ✅ | post create failure ✅ | media failure toast + redirect ✅
- Upload paths: direct < 4MB ✅ | Vercel Blob ≥ 4MB ✅
- `/api/blob` updated for media types ✅
- No TBDs or placeholders ✅
- Type consistency: `postId` (string) flows from `POST /api/posts` → `uploadMediaFile` → route param ✅
