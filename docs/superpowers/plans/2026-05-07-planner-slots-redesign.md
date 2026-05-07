# Planner Slots Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the week-bounded planner with a slot-based system: infinite-scroll view from today, configurable slot count on Recycle/Plan-Week, and AI generation cost tracked in the admin $ counter.

**Architecture:** The generate API accepts `numSlots` and builds a slot grid (day × hour) starting from today, spanning as many weeks as needed; each week gets its own `WeeklyPlan` record (already supported by `/current`). The view drops past days and uses an IntersectionObserver sentinel for auto-loading. A small inline prompt captures slot count before firing either generate button.

**Tech Stack:** Next.js 14 App Router, React 19, Prisma 7, Anthropic SDK, Tailwind CSS

---

## File Map

| File | Change |
|------|--------|
| `src/lib/planner/types.ts` | Add `hour` to `AiPickResult` |
| `src/lib/planner/prompt.ts` | Update `plan_week` tool schema + system prompt for multi-slot |
| `src/app/api/planner/generate/route.ts` | Full rewrite: slot grid, multi-week, cost tracking |
| `src/app/admin/dashboard/WeeklyPlanView.tsx` | Infinite scroll sentinel, drop past days, slot-count prompt |
| `src/app/admin/dashboard/PlannerDashboard.tsx` | Pass `numSlots` through to `handleGenerate` |

> **Start here:** Create the worktree before any edits (Task 0 below).

---

### Task 0: Create worktree

- [ ] **Step 1: Create and enter the worktree**

```bash
git worktree add ../cms-gil-planner-slots -b feature/planner-slots origin/claude/personal-cms-social-posting-QV57t
cd ../cms-gil-planner-slots
```

All subsequent tasks run from inside `../cms-gil-planner-slots`.

---

### Task 1: Update types and prompt for multi-slot AI picks

**Files:**
- Modify: `src/lib/planner/types.ts`
- Modify: `src/lib/planner/prompt.ts`

- [ ] **Step 1: Update `AiPickResult` to include `hour`**

In `src/lib/planner/types.ts`, replace:

```ts
export interface AiPickResult {
  day: string;
  postId: string;
  reasoning: string;
}
```

with:

```ts
export interface AiPickResult {
  day: string;
  hour: number;
  postId: string;
  reasoning: string;
}
```

- [ ] **Step 2: Update `PLANNER_TOOLS` plan_week schema**

In `src/lib/planner/prompt.ts`, replace the `plan_week` tool entry (lines 54–81) with:

```ts
  {
    name: "plan_week" as const,
    description: "Fill the requested slots with AI-recommended posts.",
    input_schema: {
      type: "object" as const,
      properties: {
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", description: "Date in YYYY-MM-DD format" },
              hour: {
                type: "number",
                description: "Hour-of-day in Asia/Jerusalem timezone. Must be exactly one of: 12, 15, 18, 21",
              },
              postId: { type: "string", description: "ID of the selected post" },
              reasoning: { type: "string", description: "Why this post was chosen for this slot" },
            },
            required: ["day", "hour", "postId", "reasoning"],
          },
          description: "One pick per requested slot. Match the exact day+hour pairs from the user message.",
        },
      },
      required: ["picks"],
    },
  },
```

- [ ] **Step 3: Update `parseAiPicks` to pass through `hour`**

In `src/lib/planner/prompt.ts`, replace:

```ts
export function parseAiPicks(toolInput: { picks: AiPickResult[] }): AiPickResult[] {
  return toolInput.picks.map((pick) => ({
    day: pick.day,
    postId: pick.postId,
    reasoning: pick.reasoning,
  }));
}
```

with:

```ts
export function parseAiPicks(toolInput: { picks: AiPickResult[] }): AiPickResult[] {
  return toolInput.picks.map((pick) => ({
    day: pick.day,
    hour: pick.hour,
    postId: pick.postId,
    reasoning: pick.reasoning,
  }));
}
```

- [ ] **Step 4: Update system prompt rule 5 and user message format**

In `buildPlannerSystemPrompt`, replace:

```
5. ONE POST PER DAY: Select exactly one post per day, Monday through Sunday.
```

with:

```
5. ONE POST PER SLOT: Each slot is a specific day + time (e.g. 2026-05-07 12:00). Fill every requested slot with a different post. You may assign multiple posts to the same day if multiple slots fall on that day.
```

- [ ] **Step 5: Type-check**

```bash
cd /Users/eitan/Documents/Code-Projects/CMS-Gil.nosync
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/planner/types.ts src/lib/planner/prompt.ts
git commit -m "feat(planner): update AI pick schema for multi-slot (day+hour per pick)"
```

---

### Task 2: Rewrite `generate/route.ts` — slot grid, multi-week, cost tracking

**Files:**
- Modify: `src/app/api/planner/generate/route.ts`

- [ ] **Step 1: Replace the full file contents**

Replace `src/app/api/planner/generate/route.ts` with:

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC, utcDateString } from "@/lib/planner/week";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import Anthropic from "@anthropic-ai/sdk";
import {
  getCandidatePosts,
  getRecentPublishHistory,
  getTagDistribution,
} from "@/lib/planner/candidates";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import {
  buildPlannerSystemPrompt,
  PLANNER_TOOLS,
  parseAiPicks,
} from "@/lib/planner/prompt";
import { priceForUsage } from "@/lib/assistant/cost";

const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56; // 8 weeks

interface SlotPosition {
  day: Date;
  dayKey: string;
  hour: number;
  weekStart: Date;
  weekStartKey: string;
}

async function buildSlotGrid(userId: string, numSlots: number): Promise<SlotPosition[]> {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(todayUTC.getTime() + MAX_LOOK_AHEAD_DAYS * DAY_MS);

  // Collect hours already locked by SCHEDULED or APPROVED slots in this window
  const takenSlots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["SCHEDULED", "APPROVED"] },
      day: { gte: todayUTC, lte: horizon },
    },
    select: { day: true, hour: true },
  });
  const occupied = new Set<string>();
  for (const s of takenSlots) {
    if (s.hour != null) {
      occupied.add(`${utcDateString(s.day)}:${s.hour}`);
    }
  }

  const grid: SlotPosition[] = [];
  for (let offset = 0; offset < MAX_LOOK_AHEAD_DAYS && grid.length < numSlots; offset++) {
    const day = new Date(todayUTC.getTime() + offset * DAY_MS);
    const dayKey = utcDateString(day);
    const weekStart = getMondayUTC(day);
    const weekStartKey = utcDateString(weekStart);
    for (const hour of FIXED_SLOT_HOURS) {
      if (!occupied.has(`${dayKey}:${hour}`)) {
        grid.push({ day, dayKey, hour, weekStart, weekStartKey });
        if (grid.length === numSlots) break;
      }
    }
  }
  return grid;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const preferences: string | undefined = body.preferences;
  const mode: "AI" | "DUMB" = body.mode === "DUMB" ? "DUMB" : "AI";
  const numSlots: number = typeof body.numSlots === "number" && body.numSlots > 0
    ? Math.min(body.numSlots, 56)
    : 7;

  const slotGrid = await buildSlotGrid(userId, numSlots);
  if (slotGrid.length === 0) {
    return NextResponse.json({ error: "No available slots in the next 8 weeks" }, { status: 400 });
  }

  // Group slots by week
  const weekMap = new Map<string, { weekStart: Date; positions: SlotPosition[] }>();
  for (const pos of slotGrid) {
    const entry = weekMap.get(pos.weekStartKey);
    if (entry) {
      entry.positions.push(pos);
    } else {
      weekMap.set(pos.weekStartKey, { weekStart: pos.weekStart, positions: [pos] });
    }
  }

  // Upsert one WeeklyPlan per week, collect planId by weekStartKey
  const planIdByWeek = new Map<string, string>();
  for (const [weekKey, { weekStart }] of weekMap) {
    const plan = await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: { userId, weekStart, status: "DRAFT", mode },
      update: { status: "DRAFT", mode },
    });
    planIdByWeek.set(weekKey, plan.id);
  }

  // Clear existing PROPOSED slots from all affected plans
  await prisma.weeklyPlanSlot.deleteMany({
    where: { planId: { in: [...planIdByWeek.values()] }, status: "PROPOSED" },
  });

  if (mode === "DUMB") {
    const [candidates, platformTokens] = await Promise.all([
      getCandidatePosts(userId),
      prisma.platformToken.findMany({ where: { userId }, select: { platform: true } }),
    ]);

    if (candidates.length === 0) {
      return NextResponse.json({ error: "No candidate posts available to recycle" }, { status: 400 });
    }

    const connectedPlatforms = platformTokens.map((t) => t.platform as string);
    const picks = candidates.slice(0, slotGrid.length);

    for (let i = 0; i < picks.length; i++) {
      const candidate = picks[i];
      const pos = slotGrid[i];
      const platforms = getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms);
      const planId = planIdByWeek.get(pos.weekStartKey)!;

      await prisma.weeklyPlanSlot.create({
        data: {
          planId,
          postId: candidate.id,
          day: pos.day,
          hour: pos.hour,
          status: "PROPOSED",
          reasoning: "Recycling oldest unpublished content",
          platforms,
        },
      });
    }

    return NextResponse.json({
      mode: "DUMB",
      picks: picks.map((c, i) => ({
        day: slotGrid[i].dayKey,
        hour: slotGrid[i].hour,
        postId: c.id,
      })),
    });
  }

  // AI mode
  const [candidates, history, tagDist, platformTokens] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
    prisma.platformToken.findMany({ where: { userId }, select: { platform: true } }),
  ]);

  if (candidates.length < slotGrid.length) {
    return NextResponse.json(
      { error: `Not enough candidate posts (need at least ${slotGrid.length})` },
      { status: 400 }
    );
  }

  const connectedPlatforms = platformTokens.map((t) => t.platform as string);

  const systemPrompt = buildPlannerSystemPrompt(
    candidates,
    history,
    tagDist,
    connectedPlatforms
  );

  const slotLines = slotGrid
    .map((p) => `- ${p.dayKey} ${String(p.hour).padStart(2, "0")}:00`)
    .join("\n");
  const userMessage = preferences
    ? `Plan these slots. Preferences: ${preferences}\n\nSlots to fill:\n${slotLines}`
    : `Plan these slots.\n\nSlots to fill:\n${slotLines}`;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    tools: PLANNER_TOOLS,
    tool_choice: { type: "tool", name: "plan_week" },
    messages: [{ role: "user", content: userMessage }],
  });

  // Track cost in AssistantUsage so the admin $ meter picks it up
  const costUsd = priceForUsage("claude-sonnet-4-6", response.usage);
  await prisma.assistantUsage.create({
    data: {
      userId,
      conversationId: "planner",
      model: "claude-sonnet-4-6",
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreateTokens: response.usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      costUsd,
    },
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "AI did not return a plan" }, { status: 500 });
  }

  const rawPicks = parseAiPicks(toolUse.input as { picks: import("@/lib/planner/types").AiPickResult[] });

  // Validate: postId must be from the candidate pool; day+hour must match a slot in the grid
  const candidateIds = new Set(candidates.map((c) => c.id));
  const validGridKeys = new Set(slotGrid.map((p) => `${p.dayKey}:${p.hour}`));
  const validPicks = rawPicks.filter(
    (p) => candidateIds.has(p.postId) && validGridKeys.has(`${p.day}:${p.hour}`)
  );

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  for (const pick of validPicks) {
    const candidate = candidateMap.get(pick.postId)!;
    const pos = slotGrid.find((p) => p.dayKey === pick.day && p.hour === pick.hour)!;
    const platforms = getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms);
    const planId = planIdByWeek.get(pos.weekStartKey)!;

    await prisma.weeklyPlanSlot.create({
      data: {
        planId,
        postId: pick.postId,
        day: pos.day,
        hour: pos.hour,
        status: "PROPOSED",
        reasoning: pick.reasoning,
        platforms,
      },
    });
  }

  return NextResponse.json({ mode: "AI", picks: validPicks });
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/planner/generate/route.ts
git commit -m "feat(planner): slot-grid generator — numSlots param, multi-week, cost tracking"
```

---

### Task 3: Update `WeeklyPlanView` — infinite scroll + slot-count prompt

**Files:**
- Modify: `src/app/admin/dashboard/WeeklyPlanView.tsx`

- [ ] **Step 1: Replace the file with the new implementation**

Replace `src/app/admin/dashboard/WeeklyPlanView.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarDays, Sparkles, CalendarCheck, Loader2, Trash2, Recycle } from "lucide-react";
import { format } from "date-fns";
import { utcDateString } from "@/lib/planner/week";
import { DayGroup } from "./DayGroup";
import type { WeeklyPlanData, PlanSlotData } from "@/lib/planner/types";

const DAY_MS = 86400000;
const INITIAL_FUTURE = 10;
const LOAD_MORE = 7;

type LoadingAction = "AI" | "DUMB" | "clear" | "schedule" | null;

interface WeeklyPlanViewProps {
  plan: WeeklyPlanData | null;
  loading: boolean;
  onGenerate: (preferences?: string, mode?: "AI" | "DUMB", numSlots?: number) => Promise<void>;
  onApproveSlot: (slotId: string) => Promise<void>;
  onRemoveSlot: (slotId: string) => Promise<void>;
  onClearAll: () => Promise<void>;
  onScheduleAll: () => Promise<void>;
  /** @deprecated unused — retained for compatibility */
  onSwapSlot?: (slotId: string) => void;
}

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

function buildDayRange(futureDays: number): Date[] {
  const base = todayUTC();
  const days: Date[] = [];
  for (let i = 0; i <= futureDays; i++) {
    days.push(new Date(base.getTime() + i * DAY_MS));
  }
  return days;
}

export function WeeklyPlanView({
  plan,
  loading,
  onGenerate,
  onApproveSlot,
  onRemoveSlot,
  onClearAll,
  onScheduleAll,
}: WeeklyPlanViewProps) {
  const [activeAction, setActiveAction] = useState<LoadingAction>(null);
  const [futureDays, setFutureDays] = useState(INITIAL_FUTURE);
  const days = buildDayRange(futureDays);
  const todayKey = utcDateString(todayUTC());

  // Slot-count prompt state
  const [pendingMode, setPendingMode] = useState<"AI" | "DUMB" | null>(null);
  const [slotCount, setSlotCount] = useState(7);

  // Build slot lookup — multiple slots per day
  const slotsByDay = new Map<string, PlanSlotData[]>();
  if (plan) {
    for (const slot of plan.slots) {
      const arr = slotsByDay.get(slot.day) ?? [];
      arr.push(slot);
      slotsByDay.set(slot.day, arr);
    }
  }

  const proposedSlots = plan?.slots.filter((s) => s.status === "PROPOSED") ?? [];
  const activeSlots = plan?.slots.filter(
    (s) => s.status === "PROPOSED" || s.status === "APPROVED"
  ) ?? [];

  // Scroll to today on mount
  const todayRef = useRef<HTMLDivElement>(null);
  const didScroll = useRef(false);
  useEffect(() => {
    if (!didScroll.current && todayRef.current) {
      todayRef.current.scrollIntoView({ block: "start" });
      didScroll.current = true;
    }
  });

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setFutureDays((d) => d + LOAD_MORE);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const handleGenerateConfirm = useCallback(async () => {
    if (!pendingMode) return;
    const mode = pendingMode;
    const slots = slotCount;
    setPendingMode(null);
    setActiveAction(mode);
    await onGenerate(undefined, mode, slots);
    setActiveAction(null);
  }, [pendingMode, slotCount, onGenerate]);

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="border-b border-gray-100 px-3 py-3 sm:px-4">
        <div className="mb-2.5 flex items-center gap-2">
          <CalendarDays className="h-5 w-5 shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Planner</h2>
              {plan?.mode === "DUMB" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <Recycle className="h-3 w-3" />
                  Recycle queue
                </span>
              )}
            </div>
            <p className="truncate text-[11px] text-gray-400">
              {format(days[0], "MMM d")} – {format(days[days.length - 1], "MMM d")}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {proposedSlots.length > 0 && (
            <Button
              onClick={async () => {
                setActiveAction("clear");
                await onClearAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              variant="outline"
              className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {activeAction === "clear" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              <span>Clear</span>
            </Button>
          )}
          <Button
            onClick={() => { setPendingMode("DUMB"); setSlotCount(7); }}
            disabled={loading || pendingMode !== null}
            size="sm"
            variant="outline"
            className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
            title="Fill slots with the oldest unpublished posts (no AI)"
          >
            {activeAction === "DUMB" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Recycle className="h-4 w-4" />}
            <span>Recycle</span>
          </Button>
          <Button
            onClick={() => { setPendingMode("AI"); setSlotCount(7); }}
            disabled={loading || pendingMode !== null}
            size="sm"
            className="gap-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-60"
          >
            {activeAction === "AI" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            <span>Plan</span>
          </Button>
          {activeSlots.length > 0 && (
            <Button
              onClick={async () => {
                setActiveAction("schedule");
                await onScheduleAll();
                setActiveAction(null);
              }}
              disabled={loading}
              size="sm"
              className="ml-auto gap-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-60"
            >
              {activeAction === "schedule" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />}
              <span>Approve all ({activeSlots.length})</span>
            </Button>
          )}
        </div>

        {/* Slot-count prompt — appears inline below buttons when a mode is pending */}
        {pendingMode !== null && (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-xs text-gray-600 shrink-0">How many slots?</span>
            <input
              type="number"
              min={1}
              max={56}
              value={slotCount}
              onChange={(e) => setSlotCount(Math.max(1, Math.min(56, Number(e.target.value))))}
              className="w-16 rounded border border-gray-300 bg-white px-2 py-1 text-center text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerateConfirm();
                if (e.key === "Escape") setPendingMode(null);
              }}
            />
            <span className="text-[10px] text-gray-400 shrink-0">
              4 = 1 day · 28 = 7 days
            </span>
            <Button
              size="sm"
              onClick={handleGenerateConfirm}
              className="ml-auto gap-1.5 bg-purple-600 hover:bg-purple-700"
            >
              Go
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingMode(null)}
              className="text-gray-500"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {/* Day list */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && !plan ? (
          <div className="flex h-40 items-center justify-center gap-2 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Generating plan…</span>
          </div>
        ) : (
          <div className="space-y-5">
            {days.map((day) => {
              const dayKey = utcDateString(day);
              const isToday = dayKey === todayKey;
              return (
                <div key={dayKey} ref={isToday ? todayRef : undefined}>
                  <DayGroup
                    day={day}
                    isToday={isToday}
                    slots={slotsByDay.get(dayKey) ?? []}
                    onApprove={onApproveSlot}
                    onRemove={onRemoveSlot}
                  />
                </div>
              );
            })}
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-4" />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/dashboard/WeeklyPlanView.tsx
git commit -m "feat(planner): infinite scroll from today + slot-count prompt on Recycle/Plan"
```

---

### Task 4: Wire `numSlots` through `PlannerDashboard`

**Files:**
- Modify: `src/app/admin/dashboard/PlannerDashboard.tsx`

- [ ] **Step 1: Update `handleGenerate` to accept and forward `numSlots`**

In `src/app/admin/dashboard/PlannerDashboard.tsx`, replace:

```ts
  const handleGenerate = useCallback(async (preferences?: string, mode?: "AI" | "DUMB") => {
    setLoading(true);
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences, mode: mode ?? "AI" }),
      });
      if (res.ok) {
        await refreshPlan();
      }
    } finally {
      setLoading(false);
    }
  }, [refreshPlan]);
```

with:

```ts
  const handleGenerate = useCallback(async (preferences?: string, mode?: "AI" | "DUMB", numSlots?: number) => {
    setLoading(true);
    try {
      const res = await fetch("/api/planner/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences, mode: mode ?? "AI", numSlots: numSlots ?? 7 }),
      });
      if (res.ok) {
        await refreshPlan();
      }
    } finally {
      setLoading(false);
    }
  }, [refreshPlan]);
```

Also update the `onGenerate` prop type in the `WeeklyPlanView` call — find:

```ts
            onGenerate={handleGenerate}
```

(no change needed here since TypeScript will infer it, but verify there's no `WeeklyPlanViewProps` mismatch — the prop signature was already updated in Task 3.)

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/dashboard/PlannerDashboard.tsx
git commit -m "feat(planner): forward numSlots from view through dashboard to generate API"
```

---

### Task 5: Final check and PR

- [ ] **Step 1: Verify all four previous tasks' commits are present**

```bash
git log --oneline -6
```

Expected: the four commits from Tasks 1–4, plus the spec/plan commits, on top of the base branch.

- [ ] **Step 3: Final type-check and test run**

```bash
npx tsc --noEmit
npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feature/planner-slots
gh pr create --title "feat(planner): slot-based scheduling, infinite scroll, cost tracking" --body "$(cat <<'EOF'
## Summary
- View now starts at today and infinite-scrolls forward (no past days, no manual "Later" tap)
- Recycle and Plan buttons prompt for slot count before running (default 7; 4 slots = 1 full day)
- Generate API accepts `numSlots`, builds a slot grid (day × hour) spanning as many weeks as needed
- AI generation cost (Sonnet) written to `AssistantUsage` — shows up in admin $ counter

## Test plan
- [ ] Click Recycle → prompt appears → enter 8 → Go → 8 proposed slots across 2 days
- [ ] Click Plan → prompt appears → enter 4 → Go → 4 AI-proposed slots on today
- [ ] Escape key cancels prompt without firing API
- [ ] Scroll to bottom of planner → more days load automatically
- [ ] After AI plan, reload page → check admin $ counter increased
- [ ] Mid-week run: no past-day slots proposed

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
