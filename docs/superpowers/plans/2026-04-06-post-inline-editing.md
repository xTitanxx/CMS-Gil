# Post Inline Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every post detail page always-editable with auto-save for body, date, tags, and immediate save for media add/delete.

**Architecture:** Keep `page.tsx` as a server component that fetches data and passes it as props to a new `PostEditor` client component. `PostEditor` owns all editable fields and auto-saves via a debounced PATCH call. Media mutations are immediate (no debounce).

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7, Cloudinary, Vercel Blob, vitest, react-dropzone, Tailwind CSS, shadcn/ui

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/app/api/posts/[id]/route.ts` | Modify | Add `tags` to PATCH updatable fields |
| `src/app/api/posts/[id]/media/[mediaId]/route.ts` | Create | DELETE a single media item |
| `src/app/api/posts/[id]/media/[mediaId]/route.test.ts` | Create | Unit tests for DELETE media |
| `src/app/(dashboard)/posts/[id]/PostEditor.tsx` | Create | Always-editable client component |
| `src/app/(dashboard)/posts/[id]/page.tsx` | Modify | Remove static cards, wire in PostEditor |

---

## Task 1: Add `tags` to PATCH `/api/posts/[id]`

**Files:**
- Modify: `src/app/api/posts/[id]/route.ts`

- [ ] **Step 1: Add `tags` to the PATCH data object**

Open `src/app/api/posts/[id]/route.ts`. The PATCH handler has a `data` object inside `prisma.post.updateMany`. Add `tags` after the existing `originalDate` spread:

```ts
const post = await prisma.post.updateMany({
  where: { id, userId: session.user.id },
  data: {
    ...(body.body !== undefined ? { body: body.body } : {}),
    ...(body.originalDate !== undefined
      ? { originalDate: new Date(body.originalDate) }
      : {}),
    ...(body.tags !== undefined ? { tags: body.tags } : {}),
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/posts/[id]/route.ts
git commit -m "feat: support tags in PATCH /api/posts/[id]"
```

---

## Task 2: Create DELETE `/api/posts/[id]/media/[mediaId]`

**Files:**
- Create: `src/app/api/posts/[id]/media/[mediaId]/route.test.ts`
- Create: `src/app/api/posts/[id]/media/[mediaId]/route.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/posts/[id]/media/[mediaId]/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { media: { findFirst: vi.fn(), delete: vi.fn() } },
}));
vi.mock("@/lib/storage", () => ({ deleteObject: vi.fn() }));

import { DELETE } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

const mockAuth = vi.mocked(auth);
const mockFindFirst = vi.mocked(prisma.media.findFirst);
const mockDeleteRecord = vi.mocked(prisma.media.delete);
const mockDeleteObject = vi.mocked(deleteObject);

function makeParams(id: string, mediaId: string) {
  return { params: Promise.resolve({ id, mediaId }) };
}

describe("DELETE /api/posts/[id]/media/[mediaId]", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when media does not belong to user", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue(null);
    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    expect(res.status).toBe(404);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "media1", post: { id: "post1", userId: "user1" } },
    });
  });

  it("deletes from storage and DB when authorized", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      storageKey: "users/user1/photo.jpg",
      mimeType: "image/jpeg",
    } as never);
    mockDeleteObject.mockResolvedValue(undefined);
    mockDeleteRecord.mockResolvedValue({} as never);

    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockDeleteObject).toHaveBeenCalledWith("users/user1/photo.jpg", "image/jpeg");
    expect(mockDeleteRecord).toHaveBeenCalledWith({ where: { id: "media1" } });
  });

  it("still deletes DB record if storage delete fails", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user1" } } as never);
    mockFindFirst.mockResolvedValue({
      id: "media1",
      storageKey: "users/user1/photo.jpg",
      mimeType: "image/jpeg",
    } as never);
    mockDeleteObject.mockRejectedValue(new Error("Cloudinary error"));
    mockDeleteRecord.mockResolvedValue({} as never);

    const res = await DELETE({} as Request, makeParams("post1", "media1"));
    expect(res.status).toBe(200);
    expect(mockDeleteRecord).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- src/app/api/posts/[id]/media/[mediaId]/route.test.ts
```

Expected: FAIL with "Failed to resolve import" or similar — the route file doesn't exist yet.

- [ ] **Step 3: Create the route**

Create `src/app/api/posts/[id]/media/[mediaId]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteObject } from "@/lib/storage";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: postId, mediaId } = await params;

  const media = await prisma.media.findFirst({
    where: { id: mediaId, post: { id: postId, userId: session.user.id } },
  });

  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await deleteObject(media.storageKey, media.mimeType).catch(() => {});
  await prisma.media.delete({ where: { id: mediaId } });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- src/app/api/posts/[id]/media/[mediaId]/route.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/posts/[id]/media/[mediaId]/route.ts src/app/api/posts/[id]/media/[mediaId]/route.test.ts
git commit -m "feat: add DELETE /api/posts/[id]/media/[mediaId]"
```

---

## Task 3: Create `PostEditor` component

**Files:**
- Create: `src/app/(dashboard)/posts/[id]/PostEditor.tsx`

- [ ] **Step 1: Create the file**

Create `src/app/(dashboard)/posts/[id]/PostEditor.tsx`:

```tsx
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Upload, Film, Check, AlertCircle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { ReanalyzeButton } from "./PostInteractions";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

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

export interface MediaItem {
  id: string;
  storageKey: string;
  mimeType: string;
  url: string | null;
}

interface PostEditorProps {
  postId: string;
  initialBody: string;
  initialOriginalDate: Date;
  initialTags: string[];
  initialMedia: MediaItem[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function PostEditor({
  postId,
  initialBody,
  initialOriginalDate,
  initialTags,
  initialMedia,
}: PostEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [date, setDate] = useState(() => toDatetimeLocal(new Date(initialOriginalDate)));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [media, setMedia] = useState<MediaItem[]>(initialMedia);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [mediaError, setMediaError] = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [body]);

  // Auto-save body, date, tags — skip on initial mount
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            originalDate: new Date(date).toISOString(),
            tags,
          }),
        });
        setSaveStatus(res.ok ? "saved" : "error");
      } catch {
        setSaveStatus("error");
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [body, date, tags, postId]);

  async function deleteMedia(mediaId: string) {
    setMediaError("");
    const res = await fetch(`/api/posts/${postId}/media/${mediaId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMedia((prev) => prev.filter((m) => m.id !== mediaId));
    } else {
      setMediaError("Failed to delete media. Please try again.");
    }
  }

  const onDrop = useCallback(
    (accepted: File[]) => {
      setMediaError("");
      accepted.forEach(async (file) => {
        try {
          let newMedia: MediaItem;
          if (file.size < DIRECT_UPLOAD_LIMIT) {
            const formData = new FormData();
            formData.append("file", file);
            const res = await fetch(`/api/posts/${postId}/media`, {
              method: "POST",
              body: formData,
            });
            if (!res.ok) throw new Error(await res.text());
            newMedia = await res.json();
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
            newMedia = await res.json();
          }
          setMedia((prev) => [...prev, { ...newMedia, url: null }]);
        } catch {
          setMediaError("Failed to upload file. Please try again.");
        }
      });
    },
    [postId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    multiple: true,
  });

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }

  return (
    <div className="space-y-4">
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

      {/* Content */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Content</CardTitle>
          <span className="flex items-center gap-1 text-xs text-gray-400">
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Saved
              </>
            )}
            {saveStatus === "error" && (
              <>
                <AlertCircle className="h-3 w-3 text-red-500" />
                Error saving
              </>
            )}
          </span>
        </CardHeader>
        <CardContent>
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full resize-none overflow-hidden rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </CardContent>
      </Card>

      {/* Tags */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Tags</CardTitle>
          <ReanalyzeButton postId={postId} />
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs text-gray-700"
              >
                {tag}
                <button
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder="Add tag…"
              className="w-24 rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs focus:border-blue-400 focus:outline-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Media */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Media ({media.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {media.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {media.map((m) => (
                <div key={m.id} className="relative">
                  {m.url ? (
                    m.mimeType.startsWith("video") ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video
                        src={m.url}
                        controls
                        className="rounded-lg w-full"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.url}
                        alt=""
                        className="rounded-lg w-full object-cover aspect-square"
                      />
                    )
                  ) : (
                    <div className="flex aspect-square items-center justify-center rounded-lg bg-gray-100">
                      <Film className="h-6 w-6 text-gray-400" />
                    </div>
                  )}
                  <button
                    onClick={() => deleteMedia(m.id)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="Delete media"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            {...getRootProps()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-6 text-center transition-colors ${
              isDragActive
                ? "border-blue-400 bg-blue-50"
                : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="h-5 w-5 text-gray-400 mb-1" />
            <p className="text-xs text-gray-500">
              {isDragActive ? "Drop here" : "Click or drag to add media"}
            </p>
          </div>

          {mediaError && (
            <p className="text-xs text-red-600">{mediaError}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/posts/[id]/PostEditor.tsx
git commit -m "feat: add PostEditor always-editable client component"
```

---

## Task 4: Wire `PostEditor` into `page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/posts/[id]/page.tsx`

- [ ] **Step 1: Replace static cards with PostEditor**

Replace the entire contents of `src/app/(dashboard)/posts/[id]/page.tsx` with:

```tsx
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteButton, PublishPanelWithRefresh } from "./PostInteractions";
import { PostEditor } from "./PostEditor";

export default async function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: true,
      publishes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!post) notFound();

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      id: m.id,
      storageKey: m.storageKey,
      mimeType: m.mimeType,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(() => null),
    }))
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/posts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <Badge variant="outline">{post.source}</Badge>
        </div>
        <DeleteButton postId={id} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Editable post content */}
        <div className="lg:col-span-2 space-y-4">
          <PostEditor
            postId={id}
            initialBody={post.body}
            initialOriginalDate={post.originalDate}
            initialTags={post.tags}
            initialMedia={mediaWithUrls}
          />

          {/* Publish history */}
          {post.publishes.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Publish History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {post.publishes.map((pr) => (
                    <div
                      key={pr.id}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3"
                    >
                      <div>
                        <span className="text-sm font-medium">{pr.platform}</span>
                        {pr.scheduledAt && pr.status === "PENDING" && (
                          <span className="ml-2 text-xs text-gray-500">
                            Scheduled: {format(new Date(pr.scheduledAt), "MMM d, h:mm a")}
                          </span>
                        )}
                        {pr.publishedAt && (
                          <span className="ml-2 text-xs text-gray-500">
                            {format(new Date(pr.publishedAt), "MMM d, h:mm a")}
                          </span>
                        )}
                        {pr.errorMessage && (
                          <p className="mt-1 text-xs text-red-600">{pr.errorMessage}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            pr.status === "PUBLISHED"
                              ? "success"
                              : pr.status === "FAILED"
                              ? "destructive"
                              : pr.status === "PENDING"
                              ? "warning"
                              : "secondary"
                          }
                        >
                          {pr.status}
                        </Badge>
                        {pr.platformUrl && (
                          <a
                            href={pr.platformUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Publish Panel */}
        <div>
          <PublishPanelWithRefresh postId={id} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass (including the 4 DELETE media tests from Task 2).

- [ ] **Step 3: Manual smoke test**

Start the dev server (`npm run dev`), open a post at `/posts/[id]`, and verify:
1. Body textarea auto-resizes as you type; "Saved" appears ~800ms after stopping
2. Changing the date and blurring triggers "Saving…" then "Saved"
3. Typing a tag name and pressing Enter adds it as a pill; removing a tag triggers save
4. Clicking `×` on a media item removes it from the grid immediately
5. Dragging or clicking to add a new file uploads it and adds it to the grid
6. The static date span is gone from the header; source badge remains

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/posts/[id]/page.tsx
git commit -m "feat: wire PostEditor into post detail page"
```
