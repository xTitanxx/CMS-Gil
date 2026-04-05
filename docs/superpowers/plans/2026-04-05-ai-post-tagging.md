# AI Post Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically tag imported posts using Claude AI (text + image/video frame analysis) and expose tags in the posts list search.

**Architecture:** A core `analyzePost(postId)` function in `src/lib/analyze-post.ts` handles all Claude API interaction and DB writes. A thin `POST /api/posts/[id]/analyze` route wraps it for future manual use. The import worker calls `analyzePost` directly (no HTTP) with a 5-concurrency semaphore. Tags are stored as `String[]` on the `Post` model and searched via PostgreSQL GIN index.

**Tech Stack:** `@anthropic-ai/sdk`, Cloudinary video frame URL transforms (`so_Xp` + `format: "jpg"`), Prisma PostgreSQL GIN index, vitest for unit tests.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `prisma/schema.prisma` | Modify | Add `tags String[]` + GIN index |
| `src/lib/analyze-post.ts` | **Create** | Core logic: build Claude request, fetch frames, parse tags, save to DB |
| `src/app/api/posts/[id]/analyze/route.ts` | **Create** | POST route: auth gate → call `analyzePost()` |
| `src/lib/import-worker.ts` | Modify | Fire-and-forget `analyzePost(post.id)` with semaphore after each insert |
| `src/app/api/posts/route.ts` | Modify | Extend `search` to also match tags via `OR` clause |
| `src/app/(dashboard)/posts/page.tsx` | Modify | Add `tags` to `Post` interface, render tag badges on each card |
| `src/app/(dashboard)/posts/[id]/page.tsx` | Modify | Render tags as badges in post metadata area |
| `vitest.config.ts` | **Create** | Minimal vitest config |
| `src/lib/analyze-post.test.ts` | **Create** | Unit tests for `parseTagsFromResponse` |

---

## Task 1: Install dependencies and add env var

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install `@anthropic-ai/sdk` and `vitest`**

```bash
cd ~/Documents/Code\ Projects/CMS-Gil
npm install @anthropic-ai/sdk
npm install -D vitest
```

Expected output: both packages appear in `package.json` dependencies.

- [ ] **Step 2: Add `"test"` script to `package.json`**

In `package.json`, add to the `"scripts"` block:
```json
"test": "vitest run"
```

- [ ] **Step 3: Add `ANTHROPIC_API_KEY` to local env**

Append to `.env.local`:
```
ANTHROPIC_API_KEY=<your key from console.anthropic.com>
```

- [ ] **Step 4: Add `ANTHROPIC_API_KEY` to Vercel**

```bash
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add ANTHROPIC_API_KEY preview
```

Paste the same key at the prompt.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install @anthropic-ai/sdk and vitest"
```

---

## Task 2: Add `tags` field to Prisma schema and migrate

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `tags` field and GIN index to `Post` model**

In `prisma/schema.prisma`, update the `Post` model — add `tags` after `updatedAt` and add a GIN index entry:

```prisma
model Post {
  id           String        @id @default(cuid())
  userId       String
  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  body         String
  bodyHtml     String?

  source       PostSource    @default(MANUAL)
  sourceId     String?

  originalDate DateTime
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  tags         String[]      @default([])

  media        Media[]
  publishes    PublishRecord[]

  @@index([userId, originalDate])
  @@index([sourceId])
  @@index([tags], type: Gin)
}
```

- [ ] **Step 2: Run migration**

```bash
npx prisma migrate dev --name add-post-tags
```

Expected output:
```
✔ Generated Prisma Client
The following migration(s) have been created and applied from new schema changes:

migrations/
  └─ 20260405XXXXXX_add_post_tags/
    └─ migration.sql
```

- [ ] **Step 3: Verify the generated SQL looks correct**

Open the newly created migration file in `prisma/migrations/`. It should contain:
```sql
ALTER TABLE "Post" ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "Post_tags_idx" ON "Post" USING GIN ("tags");
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add tags[] field to Post with GIN index"
```

---

## Task 3: Set up vitest and write unit tests for tag parsing

**Files:**
- Create: `vitest.config.ts`
- Create: `src/lib/analyze-post.test.ts`

The pure function `parseTagsFromResponse(text: string): string[]` will be exported from `src/lib/analyze-post.ts`. It's the only logic worth unit testing in isolation (everything else touches the network or DB).

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/analyze-post.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTagsFromResponse } from "./analyze-post";

describe("parseTagsFromResponse", () => {
  it("parses a clean JSON array", () => {
    const result = parseTagsFromResponse('["beach", "sunset", "travel"]');
    expect(result).toEqual(["beach", "sunset", "travel"]);
  });

  it("extracts JSON array from surrounding prose", () => {
    const result = parseTagsFromResponse(
      'Here are the tags: ["beach", "sunset"] — let me know if you want more.'
    );
    expect(result).toEqual(["beach", "sunset"]);
  });

  it("lowercases all tags", () => {
    const result = parseTagsFromResponse('["Beach", "SUNSET", "Travel"]');
    expect(result).toEqual(["beach", "sunset", "travel"]);
  });

  it("returns empty array when no JSON array present", () => {
    const result = parseTagsFromResponse("I could not analyze this post.");
    expect(result).toEqual([]);
  });

  it("returns empty array for malformed JSON", () => {
    const result = parseTagsFromResponse("[beach, sunset]");
    expect(result).toEqual([]);
  });

  it("filters out non-string elements", () => {
    const result = parseTagsFromResponse('["beach", 42, null, "sunset"]');
    expect(result).toEqual(["beach", "sunset"]);
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail (function not yet created)**

```bash
npm test
```

Expected: fail with `Cannot find module './analyze-post'` or similar.

---

## Task 4: Create `src/lib/analyze-post.ts`

**Files:**
- Create: `src/lib/analyze-post.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/analyze-post.ts
import Anthropic from "@anthropic-ai/sdk";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@/lib/prisma";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const client = new Anthropic();

const PROMPT = `Analyze this social media post and return a JSON array of descriptive lowercase tags.
Include tags for: subjects, objects, scenes, locations, activities, mood, colors, people descriptors, and any other relevant concepts.
Be thorough — aim for 10-20 tags. Return only the JSON array, no explanation.`;

/** Pure function — extracts a string[] from Claude's raw text response. */
export function parseTagsFromResponse(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase());
  } catch {
    return [];
  }
}

async function fetchAsBase64(
  url: string
): Promise<{ data: string; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const media_type = (
      ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(ct)
        ? ct
        : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    return { data: buffer.toString("base64"), media_type };
  } catch {
    return null;
  }
}

export async function analyzePost(postId: string): Promise<string[]> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { media: true },
  });
  if (!post) return [];

  const contentBlocks: Anthropic.MessageParam["content"] = [];

  if (post.body) {
    contentBlocks.push({ type: "text", text: `Post text: ${post.body}` });
  }

  for (const media of post.media) {
    const publicId = media.storageKey.replace(/\.[^/.]+$/, "");

    if (media.mimeType.startsWith("image/")) {
      const url = cloudinary.url(publicId, { resource_type: "image", type: "upload" });
      const img = await fetchAsBase64(url);
      if (img) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
    } else if (media.mimeType.startsWith("video/")) {
      // Extract 5 frames spread across the video duration
      for (const offset of ["0p", "25p", "50p", "75p", "100p"]) {
        const url = cloudinary.url(publicId, {
          resource_type: "video",
          type: "upload",
          transformation: [{ start_offset: offset }],
          format: "jpg",
        });
        const img = await fetchAsBase64(url);
        if (img) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: img.data },
          });
        }
      }
    }
  }

  contentBlocks.push({ type: "text", text: PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const rawText =
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "[]";
  const tags = parseTagsFromResponse(rawText);

  await prisma.post.update({ where: { id: postId }, data: { tags } });

  return tags;
}
```

- [ ] **Step 2: Run tests — they should now pass**

```bash
npm test
```

Expected output:
```
✓ src/lib/analyze-post.test.ts (6)
  ✓ parseTagsFromResponse > parses a clean JSON array
  ✓ parseTagsFromResponse > extracts JSON array from surrounding prose
  ✓ parseTagsFromResponse > lowercases all tags
  ✓ parseTagsFromResponse > returns empty array when no JSON array present
  ✓ parseTagsFromResponse > returns empty array for malformed JSON
  ✓ parseTagsFromResponse > filters out non-string elements

Test Files  1 passed (1)
Tests       6 passed (6)
```

- [ ] **Step 3: Commit**

```bash
git add vitest.config.ts src/lib/analyze-post.ts src/lib/analyze-post.test.ts
git commit -m "feat: add analyzePost with Claude vision and parseTagsFromResponse"
```

---

## Task 5: Create the analyze API route

**Files:**
- Create: `src/app/api/posts/[id]/analyze/route.ts`

- [ ] **Step 1: Create the route file**

```typescript
// src/app/api/posts/[id]/analyze/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { analyzePost } from "@/lib/analyze-post";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify the post belongs to this user
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
  });
  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tags = await analyzePost(id);
  return NextResponse.json({ tags });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/posts/[id]/analyze/route.ts
git commit -m "feat: add POST /api/posts/[id]/analyze route"
```

---

## Task 6: Wire `analyzePost` into the import worker

**Files:**
- Modify: `src/lib/import-worker.ts`

The import worker calls `analyzePost(post.id)` directly (no HTTP) after each post is created. A simple semaphore caps concurrency at 5 to avoid hammering the Claude API.

- [ ] **Step 1: Add the semaphore helper and `analyzePost` import at the top of `import-worker.ts`**

Replace the top of `src/lib/import-worker.ts` (the imports section) with:

```typescript
import { prisma } from "@/lib/prisma";
import { parseFacebookExport, guessMimeType } from "@/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { ImportSource } from "@prisma/client";
import { analyzePost } from "@/lib/analyze-post";

interface ImportOptions {
  jobId: string;
  userId: string;
  jsonContent: string;
  // Map of relative URI → Buffer (from ZIP extraction or Drive download)
  mediaFiles?: Map<string, Buffer>;
  source?: ImportSource;
}

function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
```

- [ ] **Step 2: Add the semaphore instance and tagging calls inside `runImportJob`**

In `src/lib/import-worker.ts`, add the semaphore instantiation right after the opening of `runImportJob` and the `try` block — add one line after `const errors: string[] = [];`:

```typescript
  const errors: string[] = [];
  const throttle = createSemaphore(5);
  const tagPromises: Promise<void>[] = [];
```

Then, after the line `imported++;` (after media uploads complete for a post), add:

```typescript
        imported++;

        // Fire-and-forget tagging — do not await, do not block import progress
        tagPromises.push(
          throttle(() => analyzePost(post.id).catch(() => {}))
        );
```

Then, right before the final `await prisma.importJob.update(...)` for status `"COMPLETED"`, add:

```typescript
    // Wait for all tagging to finish before marking job complete
    await Promise.allSettled(tagPromises);
```

The full `runImportJob` body after changes (for reference — insert only the three marked additions, don't replace the whole function):

```
const errors: string[] = [];
const throttle = createSemaphore(5);         // <-- ADD
const tagPromises: Promise<void>[] = [];      // <-- ADD

...
        imported++;

        // Fire-and-forget tagging               <-- ADD BLOCK
        tagPromises.push(
          throttle(() => analyzePost(post.id).catch(() => {}))
        );
...
    // Wait for all tagging
    await Promise.allSettled(tagPromises);        // <-- ADD (before COMPLETED update)

    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", ... }
    });
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/import-worker.ts
git commit -m "feat: trigger analyzePost after each imported post with concurrency limit"
```

---

## Task 7: Extend the posts API to filter by tags

**Files:**
- Modify: `src/app/api/posts/route.ts`

The existing `search` param currently only searches `body`. Extend the `where` clause so it also matches posts where the tag exists in the `tags` array. This way the existing search bar finds both text and tags with one query.

- [ ] **Step 1: Update the `where` object in `GET /api/posts`**

In `src/app/api/posts/route.ts`, replace the current `where` definition:

```typescript
  const where = {
    userId: session.user.id,
    ...(search ? { body: { contains: search, mode: "insensitive" as const } } : {}),
    ...(from || to
      ? {
          originalDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };
```

With:

```typescript
  const where = {
    userId: session.user.id,
    ...(search
      ? {
          OR: [
            { body: { contains: search, mode: "insensitive" as const } },
            { tags: { has: search.toLowerCase() } },
          ],
        }
      : {}),
    ...(from || to
      ? {
          originalDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
  };
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/posts/route.ts
git commit -m "feat: extend post search to match tags array"
```

---

## Task 8: Display tags on the post detail page

**Files:**
- Modify: `src/app/(dashboard)/posts/[id]/page.tsx`

- [ ] **Step 1: Add a Tags card to the post detail page**

In `src/app/(dashboard)/posts/[id]/page.tsx`, add the tags card immediately after the Content card (after the closing `</Card>` of the content card, before the media card). The `post` object already has `tags` from Prisma:

```tsx
          {/* Tags */}
          {post.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tags</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {post.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/posts/[id]/page.tsx
git commit -m "feat: display tags on post detail page"
```

---

## Task 9: Display tags on the posts list page

**Files:**
- Modify: `src/app/(dashboard)/posts/page.tsx`

- [ ] **Step 1: Add `tags` to the `Post` interface**

In `src/app/(dashboard)/posts/page.tsx`, update the `Post` interface:

```typescript
interface Post {
  id: string;
  body: string;
  source: string;
  originalDate: string;
  thumbUrl: string | null;
  tags: string[];
  media: { id: string; mimeType: string }[];
  publishes: { platform: string; status: string }[];
}
```

- [ ] **Step 2: Render tags below the post body excerpt**

In the post card, find the `<p className="mt-1 line-clamp-2 ...">` element and add tag badges beneath it:

```tsx
                    <p className="mt-1 line-clamp-2 text-sm text-gray-700">{post.body}</p>
                    {post.tags.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {post.tags.slice(0, 5).map((tag) => (
                          <span
                            key={tag}
                            className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {tag}
                          </span>
                        ))}
                        {post.tags.length > 5 && (
                          <span className="text-xs text-gray-400">+{post.tags.length - 5} more</span>
                        )}
                      </div>
                    )}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/posts/page.tsx
git commit -m "feat: show tags on posts list cards"
```

---

## Task 10: Deploy and verify

- [ ] **Step 1: Pull latest Vercel env vars to ensure local env is current**

```bash
npx vercel env pull .env.local
```

Then manually re-add (these are never in Vercel):
```
AUTH_URL=http://localhost:3000
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 2: Start dev server and test end-to-end locally**

```bash
npm run dev
```

1. Navigate to `/import` and import a small Facebook export ZIP (a few posts).
2. After import completes, open one of the imported posts — tags should appear within ~5–10 seconds (async).
3. Go to `/posts`, search for one of the tags by name — the post should appear.

- [ ] **Step 3: Deploy to production**

```bash
npx vercel --prod --yes
```

- [ ] **Step 4: Verify on production**

Import a test post on `cms-gil.vercel.app`. Check the post detail page for tags after a few seconds.
