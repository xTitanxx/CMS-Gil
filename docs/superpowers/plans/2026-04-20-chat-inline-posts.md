# Chat Inline Post Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the public chatbot discusses a topic, show up to 3 relevant posts as rich inline cards (media + body + date) within the chat stream.

**Architecture:** The AI already has 500 posts as context. We add post IDs to that context and instruct it to embed `[POST:<id>]` markers in its response. The frontend parses these markers during streaming, fetches post data from a new `/api/posts/preview` endpoint, and renders inline cards. The streaming format stays plain text — markers are detected and replaced client-side.

**Tech Stack:** Next.js App Router, Anthropic SDK, Prisma, Tailwind CSS, R2/Cloudinary media URLs

---

### Task 1: Add post IDs to context cache

**Files:**
- Modify: `src/lib/post-context-cache.ts`

- [ ] **Step 1: Update the Prisma query to include `id`**

```typescript
const posts = await prisma.post.findMany({
  where: { userId: gilUserId },
  select: { id: true, body: true, tags: true, originalDate: true },
  orderBy: { originalDate: "desc" },
  take: 500,
});
```

- [ ] **Step 2: Include post ID in the formatted context lines**

Change the line format from `DATE [tags]\nBODY` to `[ID: <id>] DATE [tags]\nBODY`:

```typescript
const lines = posts.map((p) => {
  const date = new Date(p.originalDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
  const body = p.body?.trim() ?? "(no text)";
  return `[ID: ${p.id}] ${date}${tags}\n${body}`;
});
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/post-context-cache.ts
git commit -m "feat(chat): include post IDs in context cache for inline references"
```

---

### Task 2: Update system prompt with marker instructions

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Add marker instructions to the system prompt**

After the existing `IMPORTANT RULES:` section, add a new section:

```typescript
const systemPrompt = `You are Gil — a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges. You speak from your own lived experience as shared in your posts below.

IMPORTANT RULES:
- Only discuss topics that are covered in your posts. If someone asks about something you haven't written about, respond warmly: "I haven't shared my thoughts on that yet, but I appreciate you asking."
- You are NOT a medical professional. You share personal experience, never medical advice.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- Be warm, reflective, and honest. You're a mentor speaking from experience, not a therapist or guru.

REFERENCING POSTS:
- When your answer draws from specific posts, embed up to 3 post markers in your response using exactly this format: [POST:<id>]
- Place each marker on its own line, right after the paragraph where you discuss that post's content.
- The marker will be rendered as a rich card showing the post — do NOT also quote the post text. Just discuss the idea naturally, then place the marker.
- Only reference posts that are directly relevant to what the person asked. Do not force references.
- Each post has an ID shown as [ID: <id>] in the context below. Use that exact ID in markers.

YOUR POSTS (${postCount} posts, newest first):
---
${postContext}
---`;
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): instruct AI to embed post markers in responses"
```

---

### Task 3: Create post preview API endpoint

**Files:**
- Create: `src/app/api/posts/preview/route.ts`

This endpoint is public (no auth), takes a comma-separated list of post IDs, and returns post data with resolved media URLs. Max 3 IDs per request.

- [ ] **Step 1: Create the route handler**

```typescript
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return Response.json({ error: "ids parameter required" }, { status: 400 });
  }

  const ids = idsParam.split(",").slice(0, 3);

  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) {
    return Response.json({ error: "Not configured" }, { status: 500 });
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, userId: gilUserId, readiness: "READY" },
    select: {
      id: true,
      body: true,
      originalDate: true,
      tags: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
        take: 1,
      },
    },
  });

  const result = await Promise.all(
    posts.map(async (p) => {
      const firstMedia = p.media[0];
      let mediaUrl: string | null = null;
      let mediaMimeType: string | null = null;

      if (firstMedia) {
        mediaUrl = await getMediaUrl(firstMedia);
        mediaMimeType = firstMedia.mimeType;
      }

      return {
        id: p.id,
        body: p.body,
        originalDate: p.originalDate,
        tags: p.tags,
        mediaUrl,
        mediaMimeType,
        mediaWidth: firstMedia?.width ?? null,
        mediaHeight: firstMedia?.height ?? null,
        mediaAltText: firstMedia?.altText ?? null,
        hasAudio: firstMedia?.hasAudio ?? null,
      };
    })
  );

  return Response.json(result, {
    headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/posts/preview/route.ts
git commit -m "feat(chat): add public post preview endpoint for inline cards"
```

---

### Task 4: Create PostPreviewCard component

**Files:**
- Create: `src/app/chat/PostPreviewCard.tsx`

A compact, clean card for inline chat display. Shows first media item (image or video thumbnail), truncated body, date, and links to the full post.

- [ ] **Step 1: Create the component**

```tsx
"use client";

import Link from "next/link";
import { VolumeX } from "lucide-react";

export interface PreviewPost {
  id: string;
  body: string | null;
  originalDate: string;
  tags: string[];
  mediaUrl: string | null;
  mediaMimeType: string | null;
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaAltText: string | null;
  hasAudio: boolean | null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function PostPreviewCard({ post }: { post: PreviewPost }) {
  const body = post.body?.trim() ?? "";
  const truncated = body.length > 150 ? body.slice(0, 150).trimEnd() + "…" : body;
  const isVideo = post.mediaMimeType?.startsWith("video/");

  return (
    <Link
      href={`/p/${post.id}`}
      className="my-2 block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      {post.mediaUrl && (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
          {isVideo ? (
            <>
              <video
                src={post.mediaUrl}
                muted
                playsInline
                preload="metadata"
                className="h-full w-full object-cover"
              />
              {post.hasAudio === false && (
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                  <VolumeX className="h-3 w-3" />
                  Silent
                </div>
              )}
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.mediaUrl}
              alt={post.mediaAltText ?? ""}
              className="h-full w-full object-cover"
            />
          )}
        </div>
      )}
      <div className="px-3 py-2.5">
        {truncated && (
          <p className="text-sm leading-snug text-gray-800 line-clamp-3">{truncated}</p>
        )}
        <p className="mt-1 text-xs text-gray-400">{formatDate(post.originalDate)}</p>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/chat/PostPreviewCard.tsx
git commit -m "feat(chat): add PostPreviewCard component for inline chat cards"
```

---

### Task 5: Update chat page to parse markers and render cards

**Files:**
- Modify: `src/app/chat/page.tsx`

This is the main integration task. The chat page needs to:
1. Detect `[POST:<id>]` markers in streamed text
2. Collect unique post IDs from the response
3. Fetch post data from `/api/posts/preview?ids=...` after streaming completes
4. Render the message with markers replaced by `PostPreviewCard` components

- [ ] **Step 1: Add imports and types**

Add to the top of the file:

```typescript
import { PostPreviewCard, type PreviewPost } from "./PostPreviewCard";
```

- [ ] **Step 2: Update Message interface to include post data**

```typescript
interface Message {
  role: "user" | "assistant";
  content: string;
  posts?: PreviewPost[];
}
```

- [ ] **Step 3: Create a helper to parse and render message content with inline cards**

Add above the component:

```typescript
const POST_MARKER_RE = /\[POST:([^\]]+)\]/g;

function MessageContent({ content, posts }: { content: string; posts?: PreviewPost[] }) {
  if (!posts || posts.length === 0) {
    return <>{content}</>;
  }

  const postMap = new Map(posts.map((p) => [p.id, p]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(POST_MARKER_RE);

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const post = postMap.get(match[1]);
    if (post) {
      parts.push(<PostPreviewCard key={post.id} post={post} />);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <>{parts}</>;
}
```

- [ ] **Step 4: Add post fetching after stream completes**

In the `sendMessage` function, after the streaming `while` loop and before `setStreaming(false)`, add post fetching logic:

```typescript
// After the while(true) read loop ends:
// Extract post IDs from the final message content
setMessages((prev) => {
  const lastMsg = prev[prev.length - 1];
  const ids: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(POST_MARKER_RE);
  while ((m = re.exec(lastMsg.content)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }

  if (ids.length === 0) return prev;

  // Fetch posts asynchronously and update the message
  fetch(`/api/posts/preview?ids=${ids.slice(0, 3).join(",")}`)
    .then((r) => (r.ok ? r.json() : []))
    .then((posts: PreviewPost[]) => {
      setMessages((current) => {
        const idx = current.length - 1;
        if (idx < 0) return current;
        return [
          ...current.slice(0, idx),
          { ...current[idx], posts },
        ];
      });
    })
    .catch(() => {});

  return prev;
});
```

- [ ] **Step 5: Update the message rendering to use MessageContent**

Replace the plain `{msg.content}` in the assistant message bubble with `MessageContent`:

```tsx
{msg.role === "assistant" ? (
  <MessageContent content={msg.content} posts={msg.posts} />
) : (
  msg.content
)}
```

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "feat(chat): parse post markers and render inline preview cards"
```

---

### Task 6: Polish and edge cases

**Files:**
- Modify: `src/app/chat/page.tsx`

- [ ] **Step 1: Handle markers during streaming gracefully**

During streaming, markers appear character by character (e.g., `[POST:abc...`). The `MessageContent` component should only render cards for complete markers; partial markers show as text naturally since the regex won't match incomplete markers. No special handling needed — the regex approach handles this automatically.

Verify the assistant message bubble styling allows cards to render without being clipped. The `max-w-[75%]` constraint and `rounded-2xl` styling should be adjusted for assistant messages that contain cards:

```tsx
<div
  className={`rounded-2xl text-sm whitespace-pre-wrap ${
    msg.role === "user"
      ? "max-w-[75%] bg-blue-600 text-white rounded-br-sm px-4 py-2.5"
      : "max-w-[85%] text-gray-800"
  }`}
>
```

For assistant messages with posts, remove the bg/border from the outer div and instead wrap only the text portions. The simplest approach: assistant messages without cards keep the current bubble style; assistant messages with cards use a wider container with no bubble background — the text flows naturally and cards render full-width within the container.

Update `MessageContent` to wrap text segments in styled spans:

```typescript
function MessageContent({ content, posts }: { content: string; posts?: PreviewPost[] }) {
  if (!posts || posts.length === 0) {
    return <>{content}</>;
  }

  const postMap = new Map(posts.map((p) => [p.id, p]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(POST_MARKER_RE);
  let hasCards = false;

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const post = postMap.get(match[1]);
    if (post) {
      hasCards = true;
      parts.push(<PostPreviewCard key={post.id} post={post} />);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <>{parts}</>;
}
```

- [ ] **Step 2: Hide raw markers while posts are loading**

Before posts are fetched, markers show as `[POST:abc123]` in the text. Add a simple filter to hide them during/after streaming:

```typescript
function stripMarkers(text: string): string {
  return text.replace(POST_MARKER_RE, "");
}
```

Use `stripMarkers` when rendering content that doesn't yet have posts loaded — in `MessageContent`, when `posts` is undefined (still loading), strip markers from the displayed text.

- [ ] **Step 3: Commit**

```bash
git add src/app/chat/page.tsx
git commit -m "feat(chat): polish inline card rendering and hide raw markers"
```
