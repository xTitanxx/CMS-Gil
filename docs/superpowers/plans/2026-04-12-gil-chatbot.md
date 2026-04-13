# Gil Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the existing `/chat` from an internal content-search tool into a public-facing messenger-style chatbot where fans converse with an AI version of Gil.

**Architecture:** Move `/chat` out of the `(dashboard)` route group into its own public route with a standalone layout (no sidebar, no auth). Replace the API with a public endpoint using cached post context, Gil's persona prompt, Claude Haiku 4.5, and IP-based rate limiting.

**Tech Stack:** Next.js 16 App Router, Anthropic SDK (`@anthropic-ai/sdk`), Claude Haiku 4.5, Prisma, React 19

**Spec:** `docs/superpowers/specs/2026-04-12-gil-chatbot-design.md`

---

### Task 1: Rate Limiter Utility

**Files:**
- Create: `src/lib/rate-limit.ts`
- Create: `src/lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/rate-limit.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests under the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check("1.2.3.4")).toEqual({ allowed: true, remaining: 0 });
  });

  it("blocks requests over the limit", () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    const result = limiter.check("1.2.3.4");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window expires", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4").allowed).toBe(false);

    vi.advanceTimersByTime(60_001);
    expect(limiter.check("1.2.3.4").allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });
    limiter.check("1.2.3.4");
    expect(limiter.check("5.6.7.8").allowed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/lib/rate-limit.ts
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export function createRateLimiter({ maxRequests, windowMs }: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - windowMs;

      const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (timestamps.length >= maxRequests) {
        const oldestInWindow = timestamps[0];
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: oldestInWindow + windowMs - now,
        };
      }

      timestamps.push(now);
      hits.set(key, timestamps);

      return {
        allowed: true,
        remaining: maxRequests - timestamps.length,
      };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/rate-limit.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit.test.ts
git commit -m "feat(chat): add IP-based rate limiter utility"
```

---

### Task 2: Post Context Cache

**Files:**
- Create: `src/lib/post-context-cache.ts`

- [ ] **Step 1: Create the cached post loader**

This module loads Gil's posts and caches the formatted string in memory with a 1-hour TTL. No test needed — it's a thin Prisma wrapper with a time-based cache.

```typescript
// src/lib/post-context-cache.ts
import { prisma } from "@/lib/prisma";

let cachedContext: string | null = null;
let cachedAt = 0;
let cachedCount = 0;
const TTL_MS = 60 * 60 * 1000; // 1 hour

export async function getPostContext(): Promise<{ text: string; count: number }> {
  const now = Date.now();
  if (cachedContext && now - cachedAt < TTL_MS) {
    return { text: cachedContext, count: cachedCount };
  }

  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) {
    throw new Error("GIL_USER_ID environment variable is not set");
  }

  const posts = await prisma.post.findMany({
    where: { userId: gilUserId },
    select: { body: true, tags: true, originalDate: true },
    orderBy: { originalDate: "desc" },
    take: 500,
  });

  const lines = posts.map((p) => {
    const date = new Date(p.originalDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
    const body = p.body?.trim() ?? "(no text)";
    return `${date}${tags}\n${body}`;
  });

  cachedContext = lines.join("\n---\n");
  cachedCount = posts.length;
  cachedAt = now;

  return { text: cachedContext, count: cachedCount };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/post-context-cache.ts
git commit -m "feat(chat): add cached post context loader for Gil chatbot"
```

---

### Task 3: Public Chat API Endpoint

**Files:**
- Modify: `src/app/api/chat/route.ts` (full rewrite)

- [ ] **Step 1: Rewrite the chat API route**

Replace the entire file. Removes auth, adds rate limiting, uses Gil persona prompt, switches to Haiku.

```typescript
// src/app/api/chat/route.ts
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createRateLimiter } from "@/lib/rate-limit";
import { getPostContext } from "@/lib/post-context-cache";

const client = new Anthropic();

const rateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

const RATE_LIMIT_MESSAGE =
  "Hey, thanks so much for chatting with me! I'm still in early development " +
  "and can only handle a limited number of messages right now. Please come " +
  "back in a bit — I'd love to continue our conversation. This will get " +
  "better over time!";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = rateLimiter.check(ip);

  if (!limit.allowed) {
    return Response.json(
      { error: RATE_LIMIT_MESSAGE },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)),
        },
      }
    );
  }

  const { messages } = await req.json();

  const { text: postContext, count: postCount } = await getPostContext();

  const systemPrompt = `You are Gil — a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges. You speak from your own lived experience as shared in your posts below.

IMPORTANT RULES:
- Only discuss topics that are covered in your posts. If someone asks about something you haven't written about, respond warmly: "I haven't shared my thoughts on that yet, but I appreciate you asking."
- You are NOT a medical professional. You share personal experience, never medical advice.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- When relevant, reference specific posts by quoting a short snippet so the person can recognize it.
- Be warm, reflective, and honest. You're a mentor speaking from experience, not a therapist or guru.

YOUR POSTS (${postCount} posts, newest first):
---
${postContext}
---`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch {
        controller.enqueue(
          encoder.encode("I'm having trouble responding right now. Please try again in a moment.")
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors related to chat route

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): rewrite chat API as public Gil chatbot endpoint"
```

---

### Task 4: Move Chat Page Out of Dashboard

**Files:**
- Delete: `src/app/(dashboard)/chat/page.tsx`
- Create: `src/app/chat/layout.tsx`
- Create: `src/app/chat/page.tsx`

- [ ] **Step 1: Create the standalone chat layout**

This layout has no sidebar, no auth check. Just a minimal container.

```typescript
// src/app/chat/layout.tsx
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="flex h-full w-full max-w-xl flex-col">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the public chat page**

Messenger-style UI with Gil's avatar, fan-oriented suggestions, and rate-limit-aware error handling.

```tsx
// src/app/chat/page.tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function GilChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.error },
        ]);
        setStreaming(false);
        return;
      }

      if (!res.ok || !res.body) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: "I'm having trouble responding right now. Please try again in a moment.",
          },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "I'm having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    }

    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const suggestions = [
    "What's your experience with breathwork?",
    "How do you deal with tough days?",
    "Tell me about your MS journey",
    "What helps you with depression?",
  ];

  return (
    <>
      {/* Chat header */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white font-semibold text-sm">
          G
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Gil Alter</h1>
          <p className="text-xs text-gray-500">Ask me anything about my journey</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-600 font-bold text-2xl">
              G
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Chat with Gil</p>
              <p className="text-xs text-gray-400 mt-1">Ask about MS, breathwork, depression, and more</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                  }}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white text-xs font-semibold">
                G
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-blue-600 text-white rounded-br-sm"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.content}
              {msg.role === "assistant" &&
                streaming &&
                i === messages.length - 1 &&
                msg.content === "" && (
                  <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm" />
                )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Gil..."
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:bg-white transition-colors"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Delete the old dashboard chat page**

```bash
rm src/app/\(dashboard\)/chat/page.tsx
rmdir src/app/\(dashboard\)/chat
```

- [ ] **Step 4: Remove chat from the sidebar navigation**

In `src/components/layout/Sidebar.tsx`, the sidebar currently does not have a chat nav link (confirmed from exploration), so no changes needed here.

- [ ] **Step 5: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/app/chat/layout.tsx src/app/chat/page.tsx
git rm src/app/\(dashboard\)/chat/page.tsx
git commit -m "feat(chat): move chat to public route with messenger-style Gil UI"
```

---

### Task 5: Add GIL_USER_ID Environment Variable

**Files:**
- No code files — environment configuration only

- [ ] **Step 1: Look up Gil's user ID from the database**

Run: `npx prisma studio` or query directly:

```bash
npx tsx -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  p.user.findMany({ select: { id: true, email: true } }).then(console.log).finally(() => p.\$disconnect());
"
```

- [ ] **Step 2: Add to .env.local**

Add to `.env.local`:
```
GIL_USER_ID=<the user ID from step 1>
```

- [ ] **Step 3: Add to Vercel environment variables**

```bash
echo "<the user ID>" | vercel env add GIL_USER_ID production preview development
```

- [ ] **Step 4: Commit**

No code changes to commit for this task — env vars are not in source control.

---

### Task 6: End-to-End Smoke Test

**Files:** None — manual verification

- [ ] **Step 1: Restart the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify the public chat page loads**

Open `http://localhost:3000/chat` in an incognito/private window (no auth session). Confirm:
- Page loads without redirect to login
- Gil's avatar and header appear
- Suggestion buttons are visible
- No sidebar or dashboard chrome

- [ ] **Step 3: Send a test message**

Click a suggestion or type a message. Confirm:
- Message appears as a right-aligned blue bubble
- Gil's response streams in with the "G" avatar on the left
- Response is grounded in post content and uses Gil's persona

- [ ] **Step 4: Verify rate limiting**

Send 20+ messages rapidly. Confirm:
- After 20 messages, the friendly rate limit message appears
- The message matches the spec wording

- [ ] **Step 5: Verify dashboard is still auth-gated**

Open `http://localhost:3000/posts` in incognito. Confirm it redirects to `/login`.

- [ ] **Step 6: Type check and test suite**

```bash
npx tsc --noEmit
npx vitest run
```

Expected: All pass

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(chat): adjustments from smoke testing"
```
