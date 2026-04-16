# Assistant Write Tools + Persistence + UI Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement task-by-task.

**Goal:** Three things in one push:
1. **Write tools** — give the agent real capability: `update_post`, `rate_post`, `archive_post`, `publish_now` (+ keep existing `schedule_post`, `unschedule`). Every write gated by a system-prompt rule: propose-in-text first, wait for confirmation.
2. **Persistence** — store conversations across sessions. Add `Conversation` + `Message` tables. The `/admin/assistant` page resumes the most-recent conversation on load.
3. **UI polish** — rewrite `ThreadView` to match the visual standard of the existing chat UIs (`src/app/chat/page.tsx` + the old `PlannerChat.tsx` — recoverable via `git show 446a98f:src/app/admin/dashboard/PlannerChat.tsx`). Rounded bubbles, Sparkles header, Loader2 thinking indicator, avatar on assistant messages, auto-scroll, suggestion chips, Enter-to-send / Shift+Enter for newline.

**Architecture:** New cases in `handleTool` for tools. New Prisma models + a thin `/api/assistant/thread` route for resume. A rewritten `ThreadView` that uses the existing chat polish patterns (extracted inline; don't create shared chat components since the existing two don't share — that convergence is a separate design decision).

**Tech Stack:** Existing — `@anthropic-ai/sdk` tool-use, Prisma 7, vitest mocks.

**Design decisions (no review needed — user waived):**
- `update_post` accepts a partial patch of `{ body?, tags?, lifecycle?, season?, readiness? }`. Sets `lifecycleOverridden=true` if `lifecycle` or `season` is in the patch.
- `archive_post` is a dedicated tool (not a flavor of `update_post`) because it also sets `archivedAt`.
- `publish_now` creates a `PublishRecord` with `scheduledAt = now`; existing `/api/cron/publish` picks it up on next tick (currently runs daily — user can manually trigger via curl if needed). No new "publish immediately" pipeline; reuses the scheduler.
- No hard-delete / trash tool. Archive is the graceful remove.
- Approval model: **prompt-level**. System prompt tells the model it MUST propose the change in prose first ("I'm about to set `body` on post X to …; confirm?") and wait for the user's affirmative before calling the tool. No structured UI gate beyond the existing schedule PlanCard (which stays as-is for schedule). If reliability becomes an issue, next iteration upgrades all writes to card-confirmed.

**File paths:**
- Modify: `src/lib/assistant/tools.ts`
- Modify: `src/lib/assistant/tools.test.ts`
- Modify: `src/lib/assistant/prompt.ts` (add confirmation rule)

---

## Task 1: `update_post` tool (TDD)

**Files:** `src/lib/assistant/tools.ts`, `src/lib/assistant/tools.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `tools.test.ts` (inside the mock setup, add `post.update: vi.fn()` to the prisma mock):

```ts
describe("handleTool update_post", () => {
  it("rejects unknown posts", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool("update_post", { postId: "x", patch: { body: "hi" } }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("updates body and tags", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool(
      "update_post",
      { postId: "p1", patch: { body: "new body", tags: ["a", "b"] } },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.body).toBe("new body");
    expect(call.data.tags).toEqual(["a", "b"]);
    expect(call.data.lifecycleOverridden).toBeUndefined();
  });

  it("sets lifecycleOverridden when lifecycle or season is patched", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool(
      "update_post",
      { postId: "p1", patch: { lifecycle: "EVERGREEN" } },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.lifecycle).toBe("EVERGREEN");
    expect(call.data.lifecycleOverridden).toBe(true);
  });

  it("rejects an empty patch", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool("update_post", { postId: "p1", patch: {} }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run — fail**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: fail (`update_post` unknown tool).

- [ ] **Step 3: Add tool schema to `ASSISTANT_TOOLS`**

Append to `ASSISTANT_TOOLS` array in `tools.ts`:

```ts
{
  name: "update_post",
  description:
    "Edits a post. Only call after the user has confirmed the change in chat. Accepts a partial patch of body/tags/lifecycle/season/readiness.",
  input_schema: {
    type: "object",
    properties: {
      postId: { type: "string" },
      patch: {
        type: "object",
        properties: {
          body: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          lifecycle: { type: "string", enum: ["EVERGREEN", "EPHEMERAL", "SEASONAL", "UNKNOWN"] },
          season: { type: "string", enum: ["SPRING", "SUMMER", "FALL", "WINTER"] },
          readiness: { type: "string", enum: ["READY", "NOT_READY", "ARCHIVED", "UNCHECKED"] },
        },
      },
    },
    required: ["postId", "patch"],
  },
},
```

- [ ] **Step 4: Add case to `handleTool` switch**

```ts
case "update_post": {
  const post = await prisma.post.findFirst({
    where: { id: String(input.postId), userId: ctx.userId },
    select: { id: true },
  });
  if (!post) return { ok: false, error: "post not found" };

  const patch = (input.patch ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (typeof patch.body === "string") data.body = patch.body;
  if (Array.isArray(patch.tags)) data.tags = patch.tags.filter((t) => typeof t === "string");
  if (typeof patch.lifecycle === "string") {
    data.lifecycle = patch.lifecycle;
    data.lifecycleOverridden = true;
  }
  if (typeof patch.season === "string") {
    data.season = patch.season;
    data.lifecycleOverridden = true;
  }
  if (typeof patch.readiness === "string") data.readiness = patch.readiness;

  if (Object.keys(data).length === 0) return { ok: false, error: "empty patch" };

  const updated = await prisma.post.update({ where: { id: post.id }, data });
  console.log("[assistant] update_post", { userId: ctx.userId, postId: post.id, fields: Object.keys(data) });
  return { ok: true, data: { id: updated.id, updated: Object.keys(data) } };
}
```

- [ ] **Step 5: Run — pass**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: all new tests pass (plus the existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/lib/assistant/tools.ts src/lib/assistant/tools.test.ts
git commit -m "feat(assistant): update_post tool (body/tags/lifecycle/season/readiness)"
```

---

## Task 2: `rate_post` tool (TDD)

**Files:** `src/lib/assistant/tools.ts`, `src/lib/assistant/tools.test.ts`

- [ ] **Step 1: Add failing tests**

In `tools.test.ts`, add `postRating.upsert: vi.fn()` to the prisma mock. Then append:

```ts
describe("handleTool rate_post", () => {
  it("rejects stars outside 1-5", async () => {
    const out = await handleTool("rate_post", { postId: "p1", stars: 7 }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("upserts rating with reasons", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.postRating.upsert as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "r1" });
    const out = await handleTool(
      "rate_post",
      { postId: "p1", stars: 5, reasons: ["timeless"], note: "great" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.postRating.upsert as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.postId).toBe("p1");
    expect(call.create.stars).toBe(5);
    expect(call.create.reasons).toEqual(["timeless"]);
    expect(call.create.note).toBe("great");
  });
});
```

- [ ] **Step 2: Add tool schema**

```ts
{
  name: "rate_post",
  description:
    "Sets the 1-5 star rating on a post. Only call after the user has confirmed the rating in chat.",
  input_schema: {
    type: "object",
    properties: {
      postId: { type: "string" },
      stars: { type: "number", description: "Integer 1-5." },
      reasons: { type: "array", items: { type: "string" } },
      note: { type: "string" },
    },
    required: ["postId", "stars"],
  },
},
```

- [ ] **Step 3: Add handler case**

```ts
case "rate_post": {
  const stars = Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5)
    return { ok: false, error: "stars must be integer 1-5" };

  const post = await prisma.post.findFirst({
    where: { id: String(input.postId), userId: ctx.userId },
    select: { id: true },
  });
  if (!post) return { ok: false, error: "post not found" };

  const reasons = Array.isArray(input.reasons)
    ? (input.reasons as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const note = typeof input.note === "string" ? input.note : null;

  const record = await prisma.postRating.upsert({
    where: { postId: post.id },
    create: { postId: post.id, stars, reasons, note },
    update: { stars, reasons, note },
  });
  console.log("[assistant] rate_post", { userId: ctx.userId, postId: post.id, stars });
  return { ok: true, data: { id: record.id, stars } };
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant/tools.ts src/lib/assistant/tools.test.ts
git commit -m "feat(assistant): rate_post tool"
```

---

## Task 3: `archive_post` and `publish_now` tools (TDD)

**Files:** `src/lib/assistant/tools.ts`, `src/lib/assistant/tools.test.ts`

- [ ] **Step 1: Add failing tests**

In `tools.test.ts`, ensure `post.update: vi.fn()` and `publishRecord.create: vi.fn()` are already mocked (from earlier). Append:

```ts
describe("handleTool archive_post", () => {
  it("sets readiness=ARCHIVED and archivedAt", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool("archive_post", { postId: "p1" }, { userId: "u1" });
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].data.readiness === "ARCHIVED",
    );
    expect(call).toBeDefined();
    expect(call![0].data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("handleTool publish_now", () => {
  it("rejects unknown platform", async () => {
    const out = await handleTool("publish_now", { postId: "p1", platform: "myspace" }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("rejects non-READY posts", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "NOT_READY" });
    const out = await handleTool(
      "publish_now",
      { postId: "p1", platform: "instagram" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(false);
  });

  it("creates a PENDING PublishRecord with scheduledAt ≈ now", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "pr1" });
    const out = await handleTool(
      "publish_now",
      { postId: "p1", platform: "instagram" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][0];
    expect(call.data.platform).toBe("INSTAGRAM");
    expect(call.data.status).toBe("PENDING");
    const scheduled = call.data.scheduledAt as Date;
    expect(Math.abs(scheduled.getTime() - Date.now())).toBeLessThan(5_000);
  });
});
```

- [ ] **Step 2: Add tool schemas**

```ts
{
  name: "archive_post",
  description:
    "Archives a post — sets readiness=ARCHIVED and archivedAt=now. Only call after the user has confirmed.",
  input_schema: {
    type: "object",
    properties: { postId: { type: "string" } },
    required: ["postId"],
  },
},
{
  name: "publish_now",
  description:
    "Queues a post to be published on the next cron tick (scheduledAt=now). Only call after the user has confirmed platform and target post. Requires readiness=READY.",
  input_schema: {
    type: "object",
    properties: {
      postId: { type: "string" },
      platform: { type: "string", enum: ["instagram", "facebook", "linkedin", "tiktok", "youtube"] },
    },
    required: ["postId", "platform"],
  },
},
```

- [ ] **Step 3: Add handler cases**

```ts
case "archive_post": {
  const post = await prisma.post.findFirst({
    where: { id: String(input.postId), userId: ctx.userId },
    select: { id: true },
  });
  if (!post) return { ok: false, error: "post not found" };
  const updated = await prisma.post.update({
    where: { id: post.id },
    data: { readiness: "ARCHIVED", archivedAt: new Date() },
  });
  console.log("[assistant] archive_post", { userId: ctx.userId, postId: post.id });
  return { ok: true, data: { id: updated.id } };
}
case "publish_now": {
  const platformSlug = String(input.platform ?? "").toLowerCase();
  const platformEnum = PLATFORM_MAP[platformSlug];
  if (!platformEnum) return { ok: false, error: "unknown platform" };

  const post = await prisma.post.findFirst({
    where: { id: String(input.postId), userId: ctx.userId },
    select: { id: true, readiness: true },
  });
  if (!post) return { ok: false, error: "post not found" };
  if (post.readiness !== "READY") return { ok: false, error: "post is not READY" };

  const record = await prisma.publishRecord.create({
    data: {
      postId: post.id,
      platform: platformEnum,
      status: "PENDING",
      scheduledAt: new Date(),
    },
  });
  console.log("[assistant] publish_now", { userId: ctx.userId, postId: post.id, platform: platformEnum });
  return { ok: true, data: record };
}
```

- [ ] **Step 4: Run — pass**

Run: `npm test -- src/lib/assistant/tools.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/assistant/tools.ts src/lib/assistant/tools.test.ts
git commit -m "feat(assistant): archive_post and publish_now tools"
```

---

## Task 4: System prompt — confirmation rule

**Files:** `src/lib/assistant/prompt.ts`

- [ ] **Step 1: Add rule**

In `prompt.ts`, replace the existing "Rules:" block with an expanded version that explicitly enumerates write tools and the confirmation protocol:

```ts
return `You are Gil's post assistant. You help him decide what to post, find things in his archive, edit posts, rate posts, archive, schedule, and publish.

Today: ${format(now, "EEEE, yyyy-MM-dd")} (${currentSeason(now).toLowerCase()})
Archive: ${totalPosts} total · ${readyCount} READY · ${ratedCount} rated
Scheduled in next 7 days: ${pendingNext7}

Read-only tools (call freely):
- recommend_posts, search_archive, get_post, list_scheduled

Write tools (confirmation-gated):
- update_post, rate_post, archive_post, schedule_post, unschedule, publish_now

Rules:
- Never invent post content, ids, or scheduling state. Use tools to ground every reference.
- Cite posts as [post:<id>] — the UI renders this as a card.
- For EVERY write tool, you MUST first describe the intended change in prose (which post, what changes, why) and wait for the user's affirmative confirmation ("yes", "do it", "confirmed"). Do not call the write tool on the same turn as your proposal.
- Respect readiness: never schedule or publish a non-READY post.
- Prefer recommend_posts for "what should I post"; search_archive for "find me".
- Keep replies tight. Tool results carry most of the info; prose only where it adds value.`;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assistant/prompt.ts
git commit -m "feat(assistant): system prompt gates write tools behind confirmation"
```

---

---

## Task 5: Conversation persistence — Prisma models

**Files:** `prisma/schema.prisma`, `prisma/migrations/…/migration.sql` (hand-written because `migrate dev` is blocked by shadow-DB replay issue — see Task 1 of the Phase 2 plan for the precedent).

- [ ] **Step 1: Add models**

Append near `DailyBrief`:

```prisma
model Conversation {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]

  @@index([userId, updatedAt])
}

model Message {
  id             String       @id @default(cuid())
  conversationId String
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String       // "user" | "assistant"
  content        Json         // array of blocks: {kind:"text",text}|{kind:"tool_use",id,name,input}|{kind:"tool_result",toolUseId,result}
  createdAt      DateTime     @default(now())

  @@index([conversationId, createdAt])
}
```

Add `conversations Conversation[]` to the `User` model.

- [ ] **Step 2: Hand-write migration**

Create `prisma/migrations/<timestamp>_assistant_conversations/migration.sql` with the two CREATE TABLE statements + indexes + FKs. Use `date -u +%Y%m%d%H%M%S` for the timestamp.

- [ ] **Step 3: Apply to DB**

```bash
npx prisma db execute --file prisma/migrations/<timestamp>_assistant_conversations/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied <timestamp>_assistant_conversations
npx prisma generate
```

- [ ] **Step 4: Typecheck + commit**

```bash
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(assistant): Conversation + Message models"
```

---

## Task 6: `/api/assistant` persists messages

**Files:** `src/app/api/assistant/route.ts`

- [ ] **Step 1: Change request contract**

Request body now accepts `{ conversationId?: string, message: string }` (single new user turn) instead of the full client-assembled `messages[]`. The server:
1. Loads the conversation (or creates one) and all its prior messages.
2. Builds the Anthropic `messages[]` from DB history.
3. Appends the new user turn + persists it immediately.
4. Runs the tool-use loop as before, emitting NDJSON events per block.
5. On each iteration, persists the assistant block (text or tool_use) and each tool_result as a separate `Message` row.
6. Emits `{ kind: "conversation", id }` at the start so the client can remember it.

Replace the current POST handler with:

```ts
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ASSISTANT_TOOLS, handleTool } from "@/lib/assistant/tools";
import { buildSystemPrompt } from "@/lib/assistant/prompt";

export const maxDuration = 60;

const client = new Anthropic();
const MAX_ITERATIONS = 6;

type PersistedBlock =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { conversationId, message }: { conversationId?: string; message: string } = await req.json();
  if (typeof message !== "string" || !message.trim())
    return NextResponse.json({ error: "empty message" }, { status: 400 });

  // Load or create conversation
  let conv = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { userId, title: message.slice(0, 60) },
      include: { messages: true },
    });
  }

  // Append the new user message
  const userMsg = await prisma.message.create({
    data: {
      conversationId: conv.id,
      role: "user",
      content: [{ kind: "text", text: message }] satisfies PersistedBlock[],
    },
  });
  conv.messages.push(userMsg);

  // Rebuild Anthropic conversation from DB
  const convo: Anthropic.MessageParam[] = conv.messages.map((m) => {
    const blocks = m.content as PersistedBlock[];
    if (m.role === "user") {
      const textOnly = blocks.filter((b): b is Extract<PersistedBlock, { kind: "text" }> => b.kind === "text");
      const toolResults = blocks.filter((b): b is Extract<PersistedBlock, { kind: "tool_result" }> => b.kind === "tool_result");
      if (toolResults.length) {
        return {
          role: "user",
          content: toolResults.map((tr): Anthropic.ToolResultBlockParam => ({
            type: "tool_result",
            tool_use_id: tr.toolUseId,
            content: JSON.stringify(tr.result),
            is_error: !tr.result.ok,
          })),
        };
      }
      return { role: "user", content: textOnly.map((b) => b.text).join("\n") };
    }
    // assistant
    return {
      role: "assistant",
      content: blocks.map((b) => {
        if (b.kind === "text") return { type: "text" as const, text: b.text };
        return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
      }),
    };
  });

  const system = await buildSystemPrompt(userId, new Date());
  const encoder = new TextEncoder();
  const conversationId_ = conv.id;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({ kind: "conversation", id: conversationId_ }) + "\n"));

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const resp = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system,
            tools: ASSISTANT_TOOLS,
            messages: convo,
          });

          const assistantBlocks: PersistedBlock[] = [];

          for (const block of resp.content) {
            if (block.type === "text") {
              assistantBlocks.push({ kind: "text", text: block.text });
              controller.enqueue(encoder.encode(JSON.stringify({ kind: "text", text: block.text }) + "\n"));
            } else if (block.type === "tool_use") {
              assistantBlocks.push({
                kind: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ kind: "tool_use", id: block.id, name: block.name, input: block.input }) + "\n",
                ),
              );
            }
          }

          await prisma.message.create({
            data: { conversationId: conversationId_, role: "assistant", content: assistantBlocks as unknown as object },
          });

          const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;

          convo.push({ role: "assistant", content: resp.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          const persistedToolResults: PersistedBlock[] = [];
          for (const tu of toolUses) {
            const result = await handleTool(tu.name, tu.input as Record<string, unknown>, { userId });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: !result.ok,
            });
            persistedToolResults.push({ kind: "tool_result", toolUseId: tu.id, result });
            controller.enqueue(
              encoder.encode(JSON.stringify({ kind: "tool_result", toolUseId: tu.id, result }) + "\n"),
            );
          }

          await prisma.message.create({
            data: { conversationId: conversationId_, role: "user", content: persistedToolResults as unknown as object },
          });

          convo.push({ role: "user", content: toolResults });
        }

        await prisma.conversation.update({
          where: { id: conversationId_ },
          data: { updatedAt: new Date() },
        });
      } catch (err) {
        console.error("/api/assistant error", err);
        controller.enqueue(
          encoder.encode(JSON.stringify({ kind: "error", message: "Sorry — something broke. Try again." }) + "\n"),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/api/assistant/route.ts
git commit -m "feat(assistant): persist conversations and resume from DB"
```

---

## Task 7: `/api/assistant/thread` GET endpoint for resume

**Files:** `src/app/api/assistant/thread/route.ts` (new)

- [ ] **Step 1: Implement**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conv = await prisma.conversation.findFirst({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  return NextResponse.json({ conversation: conv });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Soft-start a new thread: just return; client stops sending the old conversationId.
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/assistant/thread/route.ts
git commit -m "feat(assistant): GET /api/assistant/thread for resume"
```

---

## Task 8: Rewrite ThreadView — modern chat polish + thread loading

**Files:** `src/app/admin/assistant/_components/ThreadView.tsx`

Reference the existing patterns (but rewrite, don't import):
- `src/app/chat/page.tsx` — user/assistant bubbles, avatar, auto-scroll, suggestion chips, Enter-to-send
- Historical `git show 446a98f:src/app/admin/dashboard/PlannerChat.tsx` — Sparkles header, Loader2 thinking indicator, bordered card, purple accent

New spec for ThreadView:
- On mount: fetch `/api/assistant/thread` → rehydrate `messages` state from DB.
- Send path: POST `{ conversationId, message }` (not the full messages array). Capture the first NDJSON event `{kind:"conversation", id}` and store it in state so future sends include it.
- Bubble style: user = blue, right-aligned, rounded-br-sm; assistant = bordered-white card, left, rounded-bl-sm, with a small avatar circle labeled "✦" (matches the Sparkles theme).
- Tool events render as compact metadata lines between bubbles (e.g. "→ recommend_posts" with a spinner while pending).
- Tool-result arrays render PostCards (already working).
- Composer: rounded textarea, Send button disabled when empty or streaming, placeholder "Ask about the archive, or what to post…", Enter sends, Shift+Enter newline, auto-growing up to ~120px.
- Suggestion chips show only when `messages.length === 0`:
  - "What should I post today?"
  - "Find me a post about breathwork"
  - "Show me next week's schedule"
  - "Rate my last 5 posts"
- Auto-scroll to bottom on new messages.
- Thinking indicator: when waiting for server response, show a small `Loader2` bubble on the assistant side.
- Keep the PlanCard confirmation flow (from the previous fix) but drop it above the composer using the same polished card style.

Implement the full file. Use Tailwind only — match the rest of the admin's color palette (gray-200 borders, blue-600 accent).

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { PostCard } from "./PostCard";
import { PlanCard, type PlanProposal } from "./PlanCard";

type UiMsg =
  | { role: "user" | "assistant"; kind: "text"; text: string }
  | { role: "assistant"; kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { role: "assistant"; kind: "tool_result"; toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };

const SUGGESTIONS = [
  "What should I post today?",
  "Find me a post about breathwork",
  "Show me next week's schedule",
  "Rate my last 5 posts",
];

function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export function ThreadView() {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pendingPlan, setPendingPlan] = useState<PlanProposal | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resume latest thread on mount
  useEffect(() => {
    fetch("/api/assistant/thread")
      .then((r) => r.json())
      .then((d) => {
        if (!d.conversation) return;
        setConversationId(d.conversation.id);
        const rehydrated: UiMsg[] = [];
        for (const m of d.conversation.messages as { role: string; content: unknown[] }[]) {
          for (const block of m.content) {
            const b = block as { kind: string };
            if (b.kind === "text") rehydrated.push({ role: m.role as "user" | "assistant", kind: "text", text: (b as { text: string }).text });
            else if (b.kind === "tool_use") rehydrated.push({ role: "assistant", kind: "tool_use", ...(b as { id: string; name: string; input: Record<string, unknown> }) });
            else if (b.kind === "tool_result") rehydrated.push({ role: "assistant", kind: "tool_result", ...(b as { toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } }) });
          }
        }
        setMessages(rehydrated);
      })
      .catch(() => { /* nothing saved yet */ });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send(text: string) {
    const userMsg: UiMsg = { role: "user", kind: "text", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (!res.body) { setStreaming(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.kind === "conversation") setConversationId(evt.id);
          else if (evt.kind === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.kind === "text") {
                return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }];
              }
              return [...prev, { role: "assistant", kind: "text", text: evt.text }];
            });
          }
          else if (evt.kind === "tool_use") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "tool_use", id: evt.id, name: evt.name, input: evt.input }]);
          }
          else if (evt.kind === "tool_result") {
            setMessages((prev) => [...prev, { role: "assistant", kind: "tool_result", toolUseId: evt.toolUseId, result: evt.result }]);
          }
        } catch { /* swallow */ }
      }
    }
    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = input.trim();
      if (v && !streaming) send(v);
    }
  }

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      return (
        <div key={key} className={`flex items-end gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
          {m.role === "assistant" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
          )}
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-blue-600 text-white rounded-br-sm"
                : "border border-gray-200 bg-white text-gray-800 shadow-sm rounded-bl-sm"
            }`}
          >
            {m.text}
          </div>
        </div>
      );
    }
    if (m.kind === "tool_use") {
      return (
        <div key={key} className="flex items-center gap-1.5 px-10 text-xs text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{m.name}</span>
        </div>
      );
    }
    if (m.kind === "tool_result") {
      if (!m.result.ok) {
        return (
          <div key={key} className="px-10 text-xs text-red-500">
            error: {m.result.error}
          </div>
        );
      }
      const data = m.result.data as unknown;
      if (Array.isArray(data)) {
        return (
          <div key={key} className="ml-10 space-y-2">
            {(data as { postId: string; body?: string; tags?: string[]; stars?: number | null; lifecycle?: string | null; thumbUrl?: string | null; reasons?: string[]; matchReasons?: string[]; score?: number }[])
              .slice(0, 5)
              .map((r) => (
                <PostCard
                  key={r.postId}
                  data={{
                    postId: r.postId,
                    body: r.body,
                    tags: r.tags,
                    stars: r.stars,
                    lifecycle: r.lifecycle,
                    thumbUrl: r.thumbUrl,
                    reasons: r.reasons ?? r.matchReasons,
                    score: r.score,
                  }}
                  onSchedule={(postId) =>
                    setPendingPlan({ postId, platform: "instagram", scheduledAt: defaultWhen() })
                  }
                />
              ))}
          </div>
        );
      }
      return null;
    }
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="rounded-full bg-blue-100 p-1.5">
          <Sparkles className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-900">Assistant</h1>
          <p className="text-xs text-gray-500">Ask about the archive, rate, edit, or schedule posts</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-blue-100 p-3">
                <Sparkles className="h-6 w-6 text-blue-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">Your content assistant</p>
              <p className="mt-1 max-w-sm text-xs text-gray-500">
                Ask what to post, find things in your archive, edit or rate posts, or schedule publishing.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => renderMsg(m, i))}

          {streaming && (
            <div className="flex items-end gap-2 justify-start">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span className="text-xs text-gray-500">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Plan confirmation */}
      {pendingPlan && (
        <div className="mx-auto w-full max-w-3xl px-4">
          <PlanCard
            proposal={pendingPlan}
            onConfirm={async () => {
              const msg = `Schedule post ${pendingPlan.postId} on ${pendingPlan.platform} at ${pendingPlan.scheduledAt}.`;
              setPendingPlan(null);
              await send(msg);
            }}
            onCancel={() => setPendingPlan(null)}
          />
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the archive, or what to post…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={() => {
              const v = input.trim();
              if (v && !streaming) send(v);
            }}
            disabled={!input.trim() || streaming}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-[11px] text-gray-400">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/admin/assistant/_components/ThreadView.tsx
git commit -m "feat(assistant): polished chat UI with resume from DB"
```

---

## Task 9: Final verify + push

- [ ] **Step 1:** `npm test` — no new failures.
- [ ] **Step 2:** `npx tsc --noEmit` — no new errors.
- [ ] **Step 3:**
  ```bash
  git push origin feature/assistant-foundation
  ```
- [ ] **Step 4:** Update PR body to add a new "Write tools" section. Command:

```bash
gh pr edit 6 --body "$(gh pr view 6 --json body -q .body)$(cat <<'EOF'

## Addendum — write tools

Added four confirmation-gated write tools:
- `update_post` — edit body, tags, lifecycle, season, readiness (sets `lifecycleOverridden` if lifecycle/season patched)
- `rate_post` — upsert the 1–5★ rating with optional reasons and note
- `archive_post` — set readiness=ARCHIVED + archivedAt=now
- `publish_now` — create a PENDING PublishRecord with scheduledAt=now; next cron tick picks it up

All write tools require the model to propose the change in prose and wait for user confirmation before calling (enforced by system prompt). Ownership check (`userId` scoping) on every tool.
EOF
)"
```

(Or easier: just `gh pr edit 6 --body-file <(cat …)` with the manually-joined body.)
