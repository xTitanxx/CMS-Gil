# Weekly Planner Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard home with an AI-powered weekly content planner that recommends posts to recycle, lets Gil review/swap via chat, and schedules publishing across all connected platforms.

**Architecture:** Two-pane dashboard (weekly plan grid + AI chat). New Prisma models (WeeklyPlan, WeeklyPlanSlot) persist plan state. A planner-specific chat endpoint uses Claude tool_use to mutate the plan. Approval creates PublishRecords consumed by the existing cron job.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Anthropic SDK (claude-sonnet-4-6 with tool_use), React 19, Tailwind CSS 4, date-fns

**Spec:** `docs/superpowers/specs/2026-04-12-weekly-planner-dashboard-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `prisma/migrations/<timestamp>_add_weekly_planner/migration.sql` | Schema migration |
| `src/lib/planner/candidates.ts` | Query candidate posts eligible for recycling |
| `src/lib/planner/platform-assignment.ts` | Determine eligible platforms per post based on media types |
| `src/lib/planner/prompt.ts` | Build the AI system prompt and parse structured responses |
| `src/lib/planner/types.ts` | Shared TypeScript types for planner domain |
| `src/app/api/planner/current/route.ts` | GET: fetch or create this week's plan |
| `src/app/api/planner/generate/route.ts` | POST: AI generates 7 recommendations |
| `src/app/api/planner/[planId]/route.ts` | PATCH: update slot (swap, approve, remove, pin) |
| `src/app/api/planner/[planId]/schedule/route.ts` | POST: approve & create PublishRecords |
| `src/app/api/chat/planner/route.ts` | POST: planning chat with tool_use |
| `src/app/(dashboard)/dashboard/WeeklyPlanView.tsx` | Left pane: 7-day plan grid |
| `src/app/(dashboard)/dashboard/PlannerChat.tsx` | Right pane: AI chat panel |
| `src/app/(dashboard)/dashboard/PlanSlotRow.tsx` | Single day row in the plan grid |
| `src/app/(dashboard)/dashboard/ManualFacebookActions.tsx` | Copy caption + download media for FB personal |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add WeeklyPlan, WeeklyPlanSlot models, PlanStatus/SlotStatus enums, Post.publishCount field, User.weeklyPlans relation |
| `src/app/(dashboard)/dashboard/page.tsx` | Replace stats+recent with WeeklyPlanView + PlannerChat layout |
| `src/components/layout/Sidebar.tsx` | No change needed — dashboard link already exists at `/dashboard` |
| `src/app/(dashboard)/scheduled/ContentCalendar.tsx` | Add color-coding for proposed/approved plan slots |
| `src/app/api/calendar/route.ts` | Include WeeklyPlanSlot data in calendar response |

---

## Task 1: Data Model — Prisma Schema Changes

**Files:**
- Modify: `prisma/schema.prisma:40-52` (User model), `prisma/schema.prisma:64-97` (Post model), append new models after line 259

- [ ] **Step 1: Add publishCount to Post model**

In `prisma/schema.prisma`, add after the `tags` field (line 88):

```prisma
  publishCount Int           @default(0)
```

- [ ] **Step 2: Add new enums**

Append after the `PostAnalytics` model (after line 259):

```prisma
// ─── Weekly Planner ─────────────────────────────────────────────────────────

enum PlanStatus {
  DRAFT
  PARTIAL
  APPROVED
}

enum SlotStatus {
  PROPOSED
  APPROVED
  SCHEDULED
  SKIPPED
}
```

- [ ] **Step 3: Add WeeklyPlan model**

```prisma
model WeeklyPlan {
  id        String     @id @default(cuid())
  userId    String
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  weekStart DateTime
  status    PlanStatus @default(DRAFT)
  slots     WeeklyPlanSlot[]
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  @@unique([userId, weekStart])
}
```

- [ ] **Step 4: Add WeeklyPlanSlot model**

```prisma
model WeeklyPlanSlot {
  id        String     @id @default(cuid())
  planId    String
  plan      WeeklyPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  postId    String
  post      Post       @relation(fields: [postId], references: [id])
  day       DateTime
  status    SlotStatus @default(PROPOSED)
  reasoning String?
  platforms String[]

  @@unique([planId, day])
  @@index([postId])
}
```

- [ ] **Step 5: Add relations to User and Post models**

In the `User` model (around line 51), add:
```prisma
  weeklyPlans    WeeklyPlan[]
```

In the `Post` model (after line 92 `analytics`), add:
```prisma
  planSlots      WeeklyPlanSlot[]
```

- [ ] **Step 6: Generate and apply migration**

Run:
```bash
npx prisma migrate dev --name add_weekly_planner
```

Expected: Migration created and applied, Prisma client regenerated.

- [ ] **Step 7: Verify schema**

Run:
```bash
npx prisma validate
```

Expected: "Prisma schema is valid."

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add WeeklyPlan, WeeklyPlanSlot models and Post.publishCount"
```

---

## Task 2: Planner Domain Library — Types, Candidates, Platform Assignment

**Files:**
- Create: `src/lib/planner/types.ts`
- Create: `src/lib/planner/candidates.ts`
- Create: `src/lib/planner/platform-assignment.ts`
- Test: `src/lib/planner/platform-assignment.test.ts`

- [ ] **Step 1: Create types file**

Create `src/lib/planner/types.ts`:

```typescript
export interface CandidatePost {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
  publishCount: number;
  lastPublishedAt: Date | null;
  mediaTypes: string[]; // e.g. ["image/jpeg", "video/mp4"]
  hasVideo: boolean;
  hasPhoto: boolean;
  thumbUrl: string | null;
}

export interface PlanSlotData {
  id: string;
  day: string; // YYYY-MM-DD
  postId: string;
  status: "PROPOSED" | "APPROVED" | "SCHEDULED" | "SKIPPED";
  reasoning: string | null;
  platforms: string[];
  post: {
    id: string;
    body: string;
    tags: string[];
    originalDate: string;
    publishCount: number;
    thumbUrl: string | null;
    hasVideo: boolean;
  };
}

export interface WeeklyPlanData {
  id: string;
  weekStart: string; // YYYY-MM-DD
  status: "DRAFT" | "PARTIAL" | "APPROVED";
  slots: PlanSlotData[];
}

export interface AiPickResult {
  day: string; // YYYY-MM-DD
  postId: string;
  reasoning: string;
}
```

- [ ] **Step 2: Write failing test for platform assignment**

Create `src/lib/planner/platform-assignment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getEligiblePlatforms } from "./platform-assignment";

describe("getEligiblePlatforms", () => {
  const allConnected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"];

  it("assigns all platforms for video posts", () => {
    const result = getEligiblePlatforms(
      ["video/mp4", "image/jpeg"],
      allConnected
    );
    expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"]);
  });

  it("skips video-only platforms for photo-only posts", () => {
    const result = getEligiblePlatforms(
      ["image/jpeg", "image/png"],
      allConnected
    );
    expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN"]);
  });

  it("only includes LinkedIn for text-only posts", () => {
    const result = getEligiblePlatforms([], allConnected);
    expect(result).toEqual(["LINKEDIN"]);
  });

  it("only includes connected platforms", () => {
    const result = getEligiblePlatforms(
      ["video/mp4"],
      ["INSTAGRAM", "LINKEDIN"]
    );
    expect(result).toEqual(["INSTAGRAM", "LINKEDIN"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/planner/platform-assignment.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement platform assignment**

Create `src/lib/planner/platform-assignment.ts`:

```typescript
const VIDEO_ONLY_PLATFORMS = new Set(["YOUTUBE", "TIKTOK"]);
const PHOTO_OR_VIDEO_PLATFORMS = new Set(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"]);
const TEXT_PLATFORMS = new Set(["LINKEDIN"]);

export function getEligiblePlatforms(
  mediaTypes: string[],
  connectedPlatforms: string[]
): string[] {
  const hasVideo = mediaTypes.some((m) => m.startsWith("video/"));
  const hasPhoto = mediaTypes.some((m) => m.startsWith("image/"));

  let eligible: Set<string>;
  if (hasVideo) {
    eligible = PHOTO_OR_VIDEO_PLATFORMS;
  } else if (hasPhoto) {
    eligible = new Set([...PHOTO_OR_VIDEO_PLATFORMS].filter((p) => !VIDEO_ONLY_PLATFORMS.has(p)));
  } else {
    eligible = TEXT_PLATFORMS;
  }

  return connectedPlatforms.filter((p) => eligible.has(p));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/planner/platform-assignment.test.ts`
Expected: 4 tests PASS

- [ ] **Step 6: Implement candidate query**

Create `src/lib/planner/candidates.ts`:

```typescript
import { prisma } from "@/lib/prisma";
import { subWeeks, format } from "date-fns";
import type { CandidatePost } from "./types";

const RECENCY_WEEKS = 4;
const MAX_CANDIDATES = 200;

export async function getCandidatePosts(userId: string): Promise<CandidatePost[]> {
  const cutoff = subWeeks(new Date(), RECENCY_WEEKS);

  const posts = await prisma.post.findMany({
    where: {
      userId,
      media: { some: {} },
      AND: [
        {
          OR: [
            { publishes: { none: {} } },
            {
              publishes: {
                none: {
                  status: { in: ["PUBLISHED", "PENDING"] },
                  OR: [
                    { publishedAt: { gte: cutoff } },
                    { scheduledAt: { gte: new Date() } },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
    select: {
      id: true,
      body: true,
      tags: true,
      originalDate: true,
      publishCount: true,
      media: { select: { mimeType: true, storageKey: true }, take: 5 },
      publishes: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
    orderBy: [{ publishCount: "asc" }, { originalDate: "desc" }],
    take: MAX_CANDIDATES,
  });

  return posts.map((p) => {
    const mediaTypes = p.media.map((m) => m.mimeType);
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const firstMedia = p.media[0];
    const thumbUrl = firstMedia && cloudName
      ? `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_80,h_80/${firstMedia.storageKey.replace(/\.[^.]+$/, "")}`
      : null;

    return {
      id: p.id,
      body: p.body,
      tags: p.tags,
      originalDate: p.originalDate,
      publishCount: p.publishCount,
      lastPublishedAt: p.publishes[0]?.publishedAt ?? null,
      mediaTypes,
      hasVideo: mediaTypes.some((m) => m.startsWith("video/")),
      hasPhoto: mediaTypes.some((m) => m.startsWith("image/")),
      thumbUrl,
    };
  });
}

export async function getRecentPublishHistory(
  userId: string,
  weeks: number = 6
): Promise<{ tags: string[]; publishedAt: Date; postId: string }[]> {
  const cutoff = subWeeks(new Date(), weeks);

  const records = await prisma.publishRecord.findMany({
    where: {
      post: { userId },
      status: "PUBLISHED",
      publishedAt: { gte: cutoff },
    },
    select: {
      postId: true,
      publishedAt: true,
      post: { select: { tags: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  return records.map((r) => ({
    tags: r.post.tags,
    publishedAt: r.publishedAt!,
    postId: r.postId,
  }));
}

export async function getTagDistribution(
  userId: string
): Promise<Record<string, number>> {
  const posts = await prisma.post.findMany({
    where: { userId },
    select: { tags: true },
  });

  const counts: Record<string, number> = {};
  for (const p of posts) {
    for (const tag of p.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/planner/
git commit -m "feat(planner): add types, candidate query, and platform assignment"
```

---

## Task 3: AI Prompt Builder

**Files:**
- Create: `src/lib/planner/prompt.ts`

- [ ] **Step 1: Implement prompt builder and response parser**

Create `src/lib/planner/prompt.ts`:

```typescript
import { format } from "date-fns";
import type { CandidatePost, AiPickResult } from "./types";

export function buildPlannerSystemPrompt(
  candidates: CandidatePost[],
  recentHistory: { tags: string[]; publishedAt: Date; postId: string }[],
  tagDistribution: Record<string, number>,
  connectedPlatforms: string[]
): string {
  const candidateLines = candidates.map((c) => {
    const date = format(c.originalDate, "yyyy-MM-dd");
    const tags = c.tags.length > 0 ? `[${c.tags.join(", ")}]` : "[untagged]";
    const lastPub = c.lastPublishedAt ? format(c.lastPublishedAt, "yyyy-MM-dd") : "never";
    const media = c.hasVideo ? "video" : c.hasPhoto ? "photo" : "text";
    const body = c.body.slice(0, 150).replace(/\n/g, " ");
    return `ID:${c.id} | ${date} | ${tags} | published:${c.publishCount}x, last:${lastPub} | ${media} | "${body}"`;
  });

  const historyLines = recentHistory.slice(0, 50).map((h) => {
    const date = format(h.publishedAt, "yyyy-MM-dd");
    const tags = h.tags.length > 0 ? `[${h.tags.join(", ")}]` : "[untagged]";
    return `${date} ${tags} (post:${h.postId})`;
  });

  const tagLines = Object.entries(tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([tag, count]) => `${tag}: ${count} posts`);

  return `You are a content planning assistant for a personal social media content hub. Your job is to select posts to recycle across platforms each week.

CONNECTED PLATFORMS: ${connectedPlatforms.join(", ")}

SELECTION RULES:
1. TAG DIVERSITY: Spread different topics across the week. Don't put similar content on consecutive days.
2. PUBLISH COUNT FAIRNESS: Prefer posts with lower publishCount. Give under-shared content a chance.
3. EVERGREEN ONLY: Skip posts that are clearly time-bound — holiday-specific, news reactions, birthday posts, "today I..." with temporal context. Use your judgment.
4. RECENCY: All candidates have passed the 4-week cooldown, but still prefer posts not recycled recently.
5. ONE POST PER DAY: Select exactly one post per day, Monday through Sunday.

When explaining your picks, be specific: "You haven't posted about cooking in 3 weeks" is good. "This is a good post" is not.

TAG DISTRIBUTION (top tags across all content):
${tagLines.join("\n")}

RECENT PUBLISH HISTORY (last 6 weeks):
${historyLines.length > 0 ? historyLines.join("\n") : "(nothing published recently)"}

CANDIDATE POSTS (${candidates.length} eligible):
${candidateLines.join("\n")}`;
}

export const PLANNER_TOOLS = [
  {
    name: "plan_week" as const,
    description: "Fill all empty slots in the weekly plan with AI-recommended posts. Call this when the user says 'plan my week' or similar.",
    input_schema: {
      type: "object" as const,
      properties: {
        preferences: {
          type: "string",
          description: "Optional user preferences like 'focus on cooking' or 'nothing sad this week'",
        },
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", description: "Date in YYYY-MM-DD format" },
              postId: { type: "string", description: "ID of the selected post" },
              reasoning: { type: "string", description: "Why this post was chosen for this day" },
            },
            required: ["day", "postId", "reasoning"],
          },
          description: "Array of 7 picks, one per day Monday-Sunday",
        },
      },
      required: ["picks"],
    },
  },
  {
    name: "swap_day" as const,
    description: "Replace a specific day's post with a different recommendation.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
        postId: { type: "string", description: "ID of the replacement post" },
        reasoning: { type: "string", description: "Why this replacement was chosen" },
      },
      required: ["day", "postId", "reasoning"],
    },
  },
  {
    name: "remove_day" as const,
    description: "Clear a day's slot, leaving it empty.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["day"],
    },
  },
  {
    name: "assign_post" as const,
    description: "Pin a specific post to a specific day. The user describes the post they want and you find the best match from candidates.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
        postId: { type: "string", description: "ID of the post to assign" },
        reasoning: { type: "string", description: "Confirmation of which post was matched" },
      },
      required: ["day", "postId", "reasoning"],
    },
  },
  {
    name: "explain_pick" as const,
    description: "Explain in detail why a particular day's post was chosen. Use this when the user asks 'why this post?' about a specific day.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["day"],
    },
  },
];

export function parseAiPicks(toolInput: { picks: AiPickResult[] }): AiPickResult[] {
  return toolInput.picks.map((pick) => ({
    day: pick.day,
    postId: pick.postId,
    reasoning: pick.reasoning,
  }));
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/planner/prompt.ts
git commit -m "feat(planner): add AI prompt builder and tool definitions"
```

---

## Task 4: API — Get/Create Current Plan

**Files:**
- Create: `src/app/api/planner/current/route.ts`

- [ ] **Step 1: Implement GET endpoint**

Create `src/app/api/planner/current/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, format } from "date-fns";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday

  let plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    include: {
      slots: {
        include: {
          post: {
            include: { media: { take: 1 } },
          },
        },
        orderBy: { day: "asc" },
      },
    },
  });

  if (!plan) {
    plan = await prisma.weeklyPlan.create({
      data: { userId, weekStart },
      include: {
        slots: {
          include: {
            post: {
              include: { media: { take: 1 } },
            },
          },
          orderBy: { day: "asc" },
        },
      },
    });
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  const slots = plan.slots.map((s) => {
    const firstMedia = s.post.media[0];
    const thumbUrl = firstMedia && cloudName
      ? `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_80,h_80/${firstMedia.storageKey.replace(/\.[^.]+$/, "")}`
      : null;

    return {
      id: s.id,
      day: format(s.day, "yyyy-MM-dd"),
      postId: s.postId,
      status: s.status,
      reasoning: s.reasoning,
      platforms: s.platforms,
      post: {
        id: s.post.id,
        body: s.post.body,
        tags: s.post.tags,
        originalDate: format(s.post.originalDate, "yyyy-MM-dd"),
        publishCount: s.post.publishCount,
        thumbUrl,
        hasVideo: s.post.media.some((m) => m.mimeType.startsWith("video/")),
      },
    };
  });

  return NextResponse.json({
    id: plan.id,
    weekStart: format(plan.weekStart, "yyyy-MM-dd"),
    status: plan.status,
    slots,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/planner/current/route.ts
git commit -m "feat(api): GET /api/planner/current endpoint"
```

---

## Task 5: API — Generate AI Recommendations

**Files:**
- Create: `src/app/api/planner/generate/route.ts`

- [ ] **Step 1: Implement POST endpoint**

Create `src/app/api/planner/generate/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, addDays, format } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";
import { getCandidatePosts, getRecentPublishHistory, getTagDistribution } from "@/lib/planner/candidates";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { buildPlannerSystemPrompt, PLANNER_TOOLS, parseAiPicks } from "@/lib/planner/prompt";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { preferences } = await req.json() as { preferences?: string };

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));

  const [candidates, history, tagDist, tokens] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
    prisma.platformToken.findMany({
      where: { userId },
      select: { platform: true },
    }),
  ]);

  if (candidates.length < 7) {
    return NextResponse.json(
      { error: `Only ${candidates.length} eligible posts found. Need at least 7.` },
      { status: 400 }
    );
  }

  const connectedPlatforms = tokens.map((t) => t.platform);
  const systemPrompt = buildPlannerSystemPrompt(candidates, history, tagDist, connectedPlatforms);

  const userMessage = preferences
    ? `Plan my week (${days[0]} to ${days[6]}). Preferences: ${preferences}`
    : `Plan my week (${days[0]} to ${days[6]}).`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    tools: PLANNER_TOOLS,
    tool_choice: { type: "tool", name: "plan_week" },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolBlock = response.content.find((b) => b.type === "tool_use" && b.name === "plan_week");
  if (!toolBlock || toolBlock.type !== "tool_use") {
    return NextResponse.json({ error: "AI did not return a plan" }, { status: 500 });
  }

  const picks = parseAiPicks(toolBlock.input as { picks: { day: string; postId: string; reasoning: string }[] });

  // Validate all postIds exist in candidates
  const candidateIds = new Set(candidates.map((c) => c.id));
  const invalidPicks = picks.filter((p) => !candidateIds.has(p.postId));
  if (invalidPicks.length > 0) {
    return NextResponse.json(
      { error: `AI selected invalid post IDs: ${invalidPicks.map((p) => p.postId).join(", ")}` },
      { status: 500 }
    );
  }

  // Upsert plan and slots
  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    update: { status: "DRAFT" },
    create: { userId, weekStart },
  });

  // Delete existing PROPOSED slots (keep APPROVED/SCHEDULED)
  await prisma.weeklyPlanSlot.deleteMany({
    where: { planId: plan.id, status: "PROPOSED" },
  });

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  for (const pick of picks) {
    const candidate = candidateMap.get(pick.postId)!;
    const platforms = getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms);

    await prisma.weeklyPlanSlot.upsert({
      where: { planId_day: { planId: plan.id, day: new Date(pick.day) } },
      update: {
        postId: pick.postId,
        reasoning: pick.reasoning,
        platforms,
        status: "PROPOSED",
      },
      create: {
        planId: plan.id,
        postId: pick.postId,
        day: new Date(pick.day),
        reasoning: pick.reasoning,
        platforms,
      },
    });
  }

  return NextResponse.json({ planId: plan.id, picks });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/planner/generate/route.ts
git commit -m "feat(api): POST /api/planner/generate — AI recommendation endpoint"
```

---

## Task 6: API — Update Slot (Swap, Remove, Approve)

**Files:**
- Create: `src/app/api/planner/[planId]/route.ts`

- [ ] **Step 1: Implement PATCH endpoint**

Create `src/app/api/planner/[planId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;
  const plan = await prisma.weeklyPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json() as {
    action: "approve" | "remove" | "swap" | "pin";
    slotId?: string;
    day?: string;
    postId?: string;
    reasoning?: string;
    platforms?: string[];
  };

  switch (body.action) {
    case "approve": {
      if (!body.slotId) {
        return NextResponse.json({ error: "slotId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.update({
        where: { id: body.slotId },
        data: { status: "APPROVED" },
      });
      break;
    }

    case "remove": {
      if (!body.slotId) {
        return NextResponse.json({ error: "slotId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.update({
        where: { id: body.slotId },
        data: { status: "SKIPPED" },
      });
      break;
    }

    case "swap": {
      if (!body.slotId || !body.postId) {
        return NextResponse.json({ error: "slotId and postId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.update({
        where: { id: body.slotId },
        data: {
          postId: body.postId,
          reasoning: body.reasoning ?? null,
          platforms: body.platforms ?? [],
          status: "PROPOSED",
        },
      });
      break;
    }

    case "pin": {
      if (!body.day || !body.postId) {
        return NextResponse.json({ error: "day and postId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.upsert({
        where: { planId_day: { planId, day: new Date(body.day) } },
        update: {
          postId: body.postId,
          reasoning: body.reasoning ?? "Manually selected",
          platforms: body.platforms ?? [],
          status: "PROPOSED",
        },
        create: {
          planId,
          postId: body.postId,
          day: new Date(body.day),
          reasoning: body.reasoning ?? "Manually selected",
          platforms: body.platforms ?? [],
        },
      });
      break;
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Update plan status
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: { planId, status: { not: "SKIPPED" } },
  });
  const allApprovedOrScheduled = slots.length > 0 && slots.every((s) => s.status === "APPROVED" || s.status === "SCHEDULED");
  const someApproved = slots.some((s) => s.status === "APPROVED" || s.status === "SCHEDULED");

  await prisma.weeklyPlan.update({
    where: { id: planId },
    data: {
      status: allApprovedOrScheduled ? "APPROVED" : someApproved ? "PARTIAL" : "DRAFT",
    },
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/planner/\[planId\]/route.ts
git commit -m "feat(api): PATCH /api/planner/[planId] — slot update endpoint"
```

---

## Task 7: API — Approve & Schedule

**Files:**
- Create: `src/app/api/planner/[planId]/schedule/route.ts`

- [ ] **Step 1: Implement POST endpoint**

Create `src/app/api/planner/[planId]/schedule/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setHours, setMinutes } from "date-fns";

const DEFAULT_PUBLISH_HOUR = 9;
const DEFAULT_PUBLISH_MINUTE = 0;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;
  const plan = await prisma.weeklyPlan.findUnique({
    where: { id: planId },
    include: {
      slots: {
        where: { status: { in: ["PROPOSED", "APPROVED"] } },
        include: { post: true },
      },
    },
  });

  if (!plan || plan.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { slotIds } = await req.json() as { slotIds?: string[] };

  const slotsToSchedule = slotIds
    ? plan.slots.filter((s) => slotIds.includes(s.id))
    : plan.slots;

  if (slotsToSchedule.length === 0) {
    return NextResponse.json({ error: "No slots to schedule" }, { status: 400 });
  }

  let scheduled = 0;

  for (const slot of slotsToSchedule) {
    const scheduledAt = setMinutes(setHours(slot.day, DEFAULT_PUBLISH_HOUR), DEFAULT_PUBLISH_MINUTE);

    // Create PublishRecords for each non-Facebook-personal platform
    const platformsToAutoPublish = slot.platforms.filter((p) => p !== "FACEBOOK");

    for (const platform of platformsToAutoPublish) {
      // Cancel existing PENDING records for same post+platform
      await prisma.publishRecord.updateMany({
        where: { postId: slot.postId, platform: platform as any, status: "PENDING" },
        data: { status: "CANCELLED" },
      });

      await prisma.publishRecord.create({
        data: {
          postId: slot.postId,
          platform: platform as any,
          status: "PENDING",
          scheduledAt,
        },
      });
    }

    // Increment publishCount
    await prisma.post.update({
      where: { id: slot.postId },
      data: { publishCount: { increment: 1 } },
    });

    // Update slot status
    await prisma.weeklyPlanSlot.update({
      where: { id: slot.id },
      data: { status: "SCHEDULED" },
    });

    scheduled++;
  }

  // Update plan status
  const allSlots = await prisma.weeklyPlanSlot.findMany({
    where: { planId, status: { not: "SKIPPED" } },
  });
  const allScheduled = allSlots.every((s) => s.status === "SCHEDULED");

  await prisma.weeklyPlan.update({
    where: { id: planId },
    data: { status: allScheduled ? "APPROVED" : "PARTIAL" },
  });

  return NextResponse.json({ scheduled });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/planner/\[planId\]/schedule/route.ts
git commit -m "feat(api): POST /api/planner/[planId]/schedule — approve and create PublishRecords"
```

---

## Task 8: API — Planner Chat with Tool Use

**Files:**
- Create: `src/app/api/chat/planner/route.ts`

- [ ] **Step 1: Implement streaming chat with tool_use**

Create `src/app/api/chat/planner/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, addDays, format } from "date-fns";
import Anthropic from "@anthropic-ai/sdk";
import { getCandidatePosts, getRecentPublishHistory, getTagDistribution } from "@/lib/planner/candidates";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { buildPlannerSystemPrompt, PLANNER_TOOLS } from "@/lib/planner/prompt";

const client = new Anthropic();

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { messages, planId } = await req.json() as {
    messages: { role: "user" | "assistant"; content: string }[];
    planId: string;
  };

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));

  const [candidates, history, tagDist, tokens, currentPlan] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
    prisma.platformToken.findMany({
      where: { userId },
      select: { platform: true },
    }),
    prisma.weeklyPlan.findUnique({
      where: { id: planId },
      include: {
        slots: {
          include: { post: { select: { id: true, body: true, tags: true } } },
          orderBy: { day: "asc" },
        },
      },
    }),
  ]);

  const connectedPlatforms = tokens.map((t) => t.platform);
  const systemPrompt = buildPlannerSystemPrompt(candidates, history, tagDist, connectedPlatforms);

  // Add current plan state to context
  const planContext = currentPlan?.slots.length
    ? "\n\nCURRENT WEEKLY PLAN:\n" +
      currentPlan.slots
        .map((s) => {
          const day = format(s.day, "yyyy-MM-dd (EEEE)");
          const body = s.post.body.slice(0, 80).replace(/\n/g, " ");
          return `${day}: [${s.status}] ${s.post.tags.join(", ")} — "${body}" (ID:${s.postId})`;
        })
        .join("\n")
    : "\n\nCURRENT WEEKLY PLAN: (empty — no posts selected yet)";

  const fullSystemPrompt = systemPrompt + planContext +
    `\n\nWEEK DATES: ${days[0]} (Monday) to ${days[6]} (Sunday)` +
    `\n\nYou are chatting with the user about their weekly content plan. Be proactive — explain your reasoning, flag patterns, suggest improvements. Use the tools to make changes to the plan when asked.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: fullSystemPrompt,
    tools: PLANNER_TOOLS,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

  // Extract text and tool calls
  const textBlocks = response.content.filter((b) => b.type === "text");
  const toolBlocks = response.content.filter((b) => b.type === "tool_use");

  // Process tool calls
  const toolResults: { tool: string; input: Record<string, unknown> }[] = [];
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  for (const block of toolBlocks) {
    if (block.type !== "tool_use") continue;
    const input = block.input as Record<string, unknown>;
    toolResults.push({ tool: block.name, input });

    if (block.name === "plan_week") {
      const picks = (input.picks as { day: string; postId: string; reasoning: string }[]) ?? [];
      await prisma.weeklyPlanSlot.deleteMany({
        where: { planId, status: "PROPOSED" },
      });

      for (const pick of picks) {
        const candidate = candidateMap.get(pick.postId);
        const platforms = candidate
          ? getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms)
          : [];

        await prisma.weeklyPlanSlot.upsert({
          where: { planId_day: { planId, day: new Date(pick.day) } },
          update: { postId: pick.postId, reasoning: pick.reasoning, platforms, status: "PROPOSED" },
          create: { planId, postId: pick.postId, day: new Date(pick.day), reasoning: pick.reasoning, platforms },
        });
      }
    } else if (block.name === "swap_day") {
      const { day, postId, reasoning } = input as { day: string; postId: string; reasoning: string };
      const candidate = candidateMap.get(postId);
      const platforms = candidate
        ? getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms)
        : [];

      await prisma.weeklyPlanSlot.upsert({
        where: { planId_day: { planId, day: new Date(day) } },
        update: { postId, reasoning, platforms, status: "PROPOSED" },
        create: { planId, postId, day: new Date(day), reasoning, platforms },
      });
    } else if (block.name === "remove_day") {
      const { day } = input as { day: string };
      await prisma.weeklyPlanSlot.deleteMany({
        where: { planId, day: new Date(day) },
      });
    } else if (block.name === "assign_post") {
      const { day, postId, reasoning } = input as { day: string; postId: string; reasoning: string };
      const candidate = candidateMap.get(postId);
      const platforms = candidate
        ? getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms)
        : [];

      await prisma.weeklyPlanSlot.upsert({
        where: { planId_day: { planId, day: new Date(day) } },
        update: { postId, reasoning, platforms, status: "PROPOSED" },
        create: { planId, postId, day: new Date(day), reasoning, platforms },
      });
    }
  }

  const text = textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");

  return NextResponse.json({
    text,
    toolCalls: toolResults,
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/chat/planner/route.ts
git commit -m "feat(api): POST /api/chat/planner — planning chat with tool use"
```

---

## Task 9: UI — PlanSlotRow Component

**Files:**
- Create: `src/app/(dashboard)/dashboard/PlanSlotRow.tsx`

- [ ] **Step 1: Implement slot row component**

Create `src/app/(dashboard)/dashboard/PlanSlotRow.tsx`:

```tsx
"use client";

import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, X, Check, ChevronDown, ChevronUp } from "lucide-react";
import { SiInstagram, SiYoutube, SiTiktok, SiFacebook } from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import { useState } from "react";
import type { PlanSlotData } from "@/lib/planner/types";

const PLATFORM_ICON: Record<string, React.ElementType> = {
  FACEBOOK_PAGE: SiFacebook,
  INSTAGRAM: SiInstagram,
  LINKEDIN: FaLinkedin,
  YOUTUBE: SiYoutube,
  TIKTOK: SiTiktok,
};

const STATUS_STYLE: Record<string, string> = {
  PROPOSED: "border-amber-200 bg-amber-50",
  APPROVED: "border-blue-200 bg-blue-50",
  SCHEDULED: "border-green-200 bg-green-50",
};

const STATUS_BADGE: Record<string, "warning" | "default" | "success"> = {
  PROPOSED: "warning",
  APPROVED: "default",
  SCHEDULED: "success",
};

interface PlanSlotRowProps {
  day: Date;
  slot: PlanSlotData | null;
  onSwap: (day: string) => void;
  onRemove: (slotId: string) => void;
  onApprove: (slotId: string) => void;
}

export function PlanSlotRow({ day, slot, onSwap, onRemove, onApprove }: PlanSlotRowProps) {
  const [expanded, setExpanded] = useState(false);
  const dayStr = format(day, "yyyy-MM-dd");
  const dayLabel = format(day, "EEEE, MMM d");

  if (!slot) {
    return (
      <div className="flex items-center justify-between rounded-lg border-2 border-dashed border-gray-200 px-4 py-3">
        <span className="text-sm font-medium text-gray-400">{dayLabel}</span>
        <Button variant="ghost" size="sm" onClick={() => onSwap(dayStr)}>
          Fill slot
        </Button>
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-4 py-3 ${STATUS_STYLE[slot.status] ?? "border-gray-200"}`}>
      <div className="flex items-center gap-3">
        {/* Thumbnail */}
        {slot.post.thumbUrl ? (
          <img
            src={slot.post.thumbUrl}
            alt=""
            className="h-12 w-12 rounded-md object-cover flex-shrink-0"
          />
        ) : (
          <div className="h-12 w-12 rounded-md bg-gray-100 flex-shrink-0" />
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-gray-700">{dayLabel}</span>
            <Badge variant={STATUS_BADGE[slot.status]}>{slot.status}</Badge>
            {slot.post.hasVideo && (
              <span className="text-[10px] font-medium text-gray-400 uppercase">Video</span>
            )}
          </div>
          <p className="text-sm text-gray-600 line-clamp-1">{slot.post.body}</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex gap-1">
              {slot.platforms.map((p) => {
                const Icon = PLATFORM_ICON[p];
                return Icon ? <Icon key={p} size={12} className="text-gray-400" /> : null;
              })}
            </div>
            {slot.post.tags.length > 0 && (
              <span className="text-[11px] text-gray-400 truncate">
                {slot.post.tags.slice(0, 3).join(", ")}
              </span>
            )}
            <span className="text-[11px] text-gray-400">
              · {slot.post.publishCount}x shared
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {slot.status === "PROPOSED" && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onApprove(slot.id)} title="Approve">
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onSwap(dayStr)} title="Swap">
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onRemove(slot.id)} title="Remove">
                <X className="h-4 w-4 text-red-500" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Collapse" : "Show reasoning"}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Expanded reasoning */}
      {expanded && slot.reasoning && (
        <p className="mt-2 text-xs text-gray-500 italic border-t border-gray-200 pt-2">
          {slot.reasoning}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/PlanSlotRow.tsx
git commit -m "feat(ui): PlanSlotRow component for weekly plan grid"
```

---

## Task 10: UI — ManualFacebookActions Component

**Files:**
- Create: `src/app/(dashboard)/dashboard/ManualFacebookActions.tsx`

- [ ] **Step 1: Extract reusable Facebook manual actions**

Create `src/app/(dashboard)/dashboard/ManualFacebookActions.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { Copy, Check, Download } from "lucide-react";

interface ManualFacebookActionsProps {
  body: string;
  postId: string;
}

export function ManualFacebookActions({ body, postId }: ManualFacebookActionsProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyCaption = async () => {
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={copyCaption}
        disabled={!body}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {copied ? (
          <>
            <Check className="h-3 w-3" />
            Copied!
          </>
        ) : (
          <>
            <Copy className="h-3 w-3" />
            Copy caption
          </>
        )}
      </button>
      <a
        href={`/posts/${postId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        <Download className="h-3 w-3" />
        Download media
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/ManualFacebookActions.tsx
git commit -m "feat(ui): ManualFacebookActions component"
```

---

## Task 11: UI — PlannerChat Component

**Files:**
- Create: `src/app/(dashboard)/dashboard/PlannerChat.tsx`

- [ ] **Step 1: Implement chat panel**

Create `src/app/(dashboard)/dashboard/PlannerChat.tsx`:

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface PlannerChatProps {
  planId: string;
  onPlanUpdated: () => void;
}

const SUGGESTED_PROMPTS = [
  "Plan my week",
  "Focus on uplifting content",
  "Include something about cooking",
  "Skip anything sad this week",
];

export function PlannerChat({ planId, onPlanUpdated }: PlannerChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const newMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat/planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, planId }),
      });

      if (!res.ok) {
        const err = await res.json();
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: err.error ?? "Something went wrong." },
        ]);
        setLoading(false);
        return;
      }

      const data = await res.json();

      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: data.text || "Done — I've updated the plan." },
      ]);

      if (data.toolCalls && data.toolCalls.length > 0) {
        onPlanUpdated();
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { role: "assistant", content: "Something went wrong. Please try again." },
      ]);
    }

    setLoading(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex flex-col h-full border-l border-gray-200">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <Sparkles className="h-4 w-4 text-purple-500" />
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Planning Assistant</h2>
          <p className="text-[11px] text-gray-500">Chat to build your weekly plan</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <Sparkles className="h-8 w-8 text-purple-200" />
            <p className="text-sm text-gray-500">What would you like to post this week?</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-purple-600 text-white rounded-br-sm"
                  : "bg-white border border-gray-200 text-gray-800 rounded-bl-sm"
              }`}
            >
              {msg.content}
              {msg.role === "assistant" && loading && i === messages.length - 1 && msg.content === "" && (
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
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell me what to plan..."
            rows={1}
            className="flex-1 resize-none rounded-xl border border-gray-300 bg-gray-50 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none focus:bg-white transition-colors"
            style={{ maxHeight: "80px", overflowY: "auto" }}
          />
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="bg-purple-600 hover:bg-purple-700 text-white h-9 w-9 p-0 rounded-xl flex-shrink-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/PlannerChat.tsx
git commit -m "feat(ui): PlannerChat component with suggested prompts"
```

---

## Task 12: UI — WeeklyPlanView Component

**Files:**
- Create: `src/app/(dashboard)/dashboard/WeeklyPlanView.tsx`

- [ ] **Step 1: Implement weekly plan grid**

Create `src/app/(dashboard)/dashboard/WeeklyPlanView.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { startOfWeek, addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { CalendarDays, Loader2 } from "lucide-react";
import { PlanSlotRow } from "./PlanSlotRow";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  onGenerate: (preferences?: string) => Promise<void>;
  onApproveSlot: (slotId: string) => Promise<void>;
  onRemoveSlot: (slotId: string) => Promise<void>;
  onSwapSlot: (day: string) => void;
  onScheduleAll: () => Promise<void>;
}

export function WeeklyPlanView({
  plan,
  loading,
  onGenerate,
  onApproveSlot,
  onRemoveSlot,
  onSwapSlot,
  onScheduleAll,
}: WeeklyPlanViewProps) {
  const [generating, setGenerating] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const slotByDay = new Map<string, PlanSlotData>();
  if (plan) {
    for (const slot of plan.slots) {
      slotByDay.set(slot.day, slot);
    }
  }

  const handleGenerate = async () => {
    setGenerating(true);
    await onGenerate();
    setGenerating(false);
  };

  const handleScheduleAll = async () => {
    setScheduling(true);
    await onScheduleAll();
    setScheduling(false);
  };

  const hasProposedSlots = plan?.slots.some((s) => s.status === "PROPOSED" || s.status === "APPROVED");
  const hasAnySlots = plan && plan.slots.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-gray-700" />
          <div>
            <h1 className="text-base font-semibold text-gray-900">Weekly Plan</h1>
            <p className="text-[11px] text-gray-500">
              {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
            </p>
          </div>
        </div>
        <Button
          onClick={handleGenerate}
          disabled={generating || loading}
          className="bg-purple-600 hover:bg-purple-700"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Planning...
            </>
          ) : (
            "Plan My Week"
          )}
        </Button>
      </div>

      {/* Plan grid */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          days.map((day) => {
            const dayStr = format(day, "yyyy-MM-dd");
            const slot = slotByDay.get(dayStr) ?? null;
            return (
              <PlanSlotRow
                key={dayStr}
                day={day}
                slot={slot}
                onSwap={onSwapSlot}
                onRemove={onRemoveSlot}
                onApprove={onApproveSlot}
              />
            );
          })
        )}
      </div>

      {/* Footer */}
      {hasProposedSlots && (
        <div className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0">
          <Button
            onClick={handleScheduleAll}
            disabled={scheduling}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {scheduling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Scheduling...
              </>
            ) : (
              "Approve & Schedule All"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/WeeklyPlanView.tsx
git commit -m "feat(ui): WeeklyPlanView component"
```

---

## Task 13: Dashboard Page — Replace with Planner Layout

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (replace entirely)

- [ ] **Step 1: Create client wrapper for planner state**

The dashboard page becomes a server component that fetches initial data, rendering a client component that manages the two-pane planner state.

Replace `src/app/(dashboard)/dashboard/page.tsx` entirely with:

```tsx
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, format } from "date-fns";
import { PlannerDashboard } from "./PlannerDashboard";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  const [plan, stats] = await Promise.all([
    prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
      include: {
        slots: {
          where: { status: { not: "SKIPPED" } },
          include: {
            post: {
              include: { media: { take: 1, select: { mimeType: true, storageKey: true } } },
            },
          },
          orderBy: { day: "asc" },
        },
      },
    }),
    Promise.all([
      prisma.post.count({ where: { userId } }),
      prisma.publishRecord.count({ where: { post: { userId }, status: "PUBLISHED" } }),
      prisma.publishRecord.count({
        where: { post: { userId }, status: "PENDING", scheduledAt: { not: null } },
      }),
    ]),
  ]);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  const initialPlan = plan
    ? {
        id: plan.id,
        weekStart: format(plan.weekStart, "yyyy-MM-dd"),
        status: plan.status as "DRAFT" | "PARTIAL" | "APPROVED",
        slots: plan.slots.map((s) => {
          const firstMedia = s.post.media[0];
          const thumbUrl =
            firstMedia && cloudName
              ? `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_80,h_80/${firstMedia.storageKey.replace(/\.[^.]+$/, "")}`
              : null;
          return {
            id: s.id,
            day: format(s.day, "yyyy-MM-dd"),
            postId: s.postId,
            status: s.status as "PROPOSED" | "APPROVED" | "SCHEDULED",
            reasoning: s.reasoning,
            platforms: s.platforms,
            post: {
              id: s.post.id,
              body: s.post.body,
              tags: s.post.tags,
              originalDate: format(s.post.originalDate, "yyyy-MM-dd"),
              publishCount: s.post.publishCount,
              thumbUrl,
              hasVideo: s.post.media.some((m) => m.mimeType.startsWith("video/")),
            },
          };
        }),
      }
    : null;

  const [totalPosts, totalPublished, pendingScheduled] = stats;

  return (
    <PlannerDashboard
      initialPlan={initialPlan}
      stats={{ totalPosts, totalPublished, pendingScheduled }}
    />
  );
}
```

- [ ] **Step 2: Create PlannerDashboard client component**

Create `src/app/(dashboard)/dashboard/PlannerDashboard.tsx`:

```tsx
"use client";

import { useState, useCallback } from "react";
import { WeeklyPlanView } from "./WeeklyPlanView";
import { PlannerChat } from "./PlannerChat";
import type { WeeklyPlanData } from "@/lib/planner/types";

interface PlannerDashboardProps {
  initialPlan: WeeklyPlanData | null;
  stats: { totalPosts: number; totalPublished: number; pendingScheduled: number };
}

export function PlannerDashboard({ initialPlan, stats }: PlannerDashboardProps) {
  const [plan, setPlan] = useState<WeeklyPlanData | null>(initialPlan);
  const [loading, setLoading] = useState(false);

  const refreshPlan = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/planner/current");
      if (res.ok) {
        const data = await res.json();
        setPlan(data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerate = useCallback(async (preferences?: string) => {
    const res = await fetch("/api/planner/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences }),
    });
    if (res.ok) {
      await refreshPlan();
    }
  }, [refreshPlan]);

  const handleApproveSlot = useCallback(async (slotId: string) => {
    if (!plan) return;
    await fetch(`/api/planner/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", slotId }),
    });
    await refreshPlan();
  }, [plan, refreshPlan]);

  const handleRemoveSlot = useCallback(async (slotId: string) => {
    if (!plan) return;
    await fetch(`/api/planner/${plan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", slotId }),
    });
    await refreshPlan();
  }, [plan, refreshPlan]);

  const handleSwapSlot = useCallback((day: string) => {
    // For now, swap via chat — user types "swap [day]" in chat
    // Could add a modal picker later
  }, []);

  const handleScheduleAll = useCallback(async () => {
    if (!plan) return;
    await fetch(`/api/planner/${plan.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    await refreshPlan();
  }, [plan, refreshPlan]);

  return (
    <div className="flex flex-col h-full -m-8">
      {/* Compact stats bar */}
      <div className="flex items-center gap-6 border-b border-gray-200 bg-white px-6 py-2 flex-shrink-0">
        <span className="text-xs text-gray-500">
          <strong className="text-gray-700">{stats.totalPosts}</strong> posts
        </span>
        <span className="text-xs text-gray-500">
          <strong className="text-gray-700">{stats.totalPublished}</strong> published
        </span>
        <span className="text-xs text-gray-500">
          <strong className="text-gray-700">{stats.pendingScheduled}</strong> scheduled
        </span>
      </div>

      {/* Two-pane layout */}
      <div className="flex flex-1 min-h-0">
        <div className="w-3/5">
          <WeeklyPlanView
            plan={plan}
            loading={loading}
            onGenerate={handleGenerate}
            onApproveSlot={handleApproveSlot}
            onRemoveSlot={handleRemoveSlot}
            onSwapSlot={handleSwapSlot}
            onScheduleAll={handleScheduleAll}
          />
        </div>
        <div className="w-2/5">
          <PlannerChat
            planId={plan?.id ?? ""}
            onPlanUpdated={refreshPlan}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to planner files.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/page.tsx src/app/\(dashboard\)/dashboard/PlannerDashboard.tsx
git commit -m "feat(dashboard): replace home page with weekly planner + chat layout"
```

---

## Task 14: Calendar Integration — Show Plan State

**Files:**
- Modify: `src/app/api/calendar/route.ts`
- Modify: `src/app/(dashboard)/scheduled/ContentCalendar.tsx`

- [ ] **Step 1: Extend calendar API to include plan slots**

In `src/app/api/calendar/route.ts`, add a query for WeeklyPlanSlot data alongside existing PublishRecord queries. After the existing parallel queries, add:

```typescript
const planSlots = await prisma.weeklyPlanSlot.findMany({
  where: {
    plan: { userId },
    day: { gte: startDate, lte: endDate },
    status: { in: ["PROPOSED", "APPROVED"] },
  },
  include: {
    post: { include: { media: { take: 1 } } },
  },
});
```

Map these into CalendarEntry format with status values `"PROPOSED"` and `"PLAN_APPROVED"`, and include them in the response entries array. Avoid duplicating entries for slots that already have PublishRecords (status SCHEDULED).

- [ ] **Step 2: Update ContentCalendar rendering**

In `src/app/(dashboard)/scheduled/ContentCalendar.tsx` (or its sub-components WeekView/MonthView), add styling for the new statuses:

- `PROPOSED` entries: gray/dashed border, lighter opacity
- `PLAN_APPROVED` entries: blue border

Update the status badge and entry dot color mapping to include these new values.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/calendar/route.ts src/app/\(dashboard\)/scheduled/
git commit -m "feat(calendar): show weekly plan slots alongside scheduled posts"
```

---

## Task 15: Type Check, Test, and Final Verification

**Files:** All planner files

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass, including the new platform-assignment tests.

- [ ] **Step 2: Full TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify build succeeds**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address type errors and test failures from planner feature"
```
