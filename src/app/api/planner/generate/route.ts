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
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import {
  buildPlannerSystemPrompt,
  PLANNER_TOOLS,
  parseAiPicks,
} from "@/lib/planner/prompt";
import { priceForUsage } from "@/lib/assistant/cost";
import type { AiPickResult } from "@/lib/planner/types";

const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56; // 8 weeks safety valve

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
  const numSlots: number =
    typeof body.numSlots === "number" && body.numSlots > 0
      ? Math.min(body.numSlots, 56)
      : 7;

  const slotGrid = await buildSlotGrid(userId, numSlots);
  if (slotGrid.length === 0) {
    return NextResponse.json(
      { error: "No available slots in the next 8 weeks" },
      { status: 400 }
    );
  }

  // Group slots by week, upsert one WeeklyPlan per week
  const weekMap = new Map<string, { weekStart: Date; positions: SlotPosition[] }>();
  for (const pos of slotGrid) {
    const entry = weekMap.get(pos.weekStartKey);
    if (entry) {
      entry.positions.push(pos);
    } else {
      weekMap.set(pos.weekStartKey, { weekStart: pos.weekStart, positions: [pos] });
    }
  }

  const planIdByWeek = new Map<string, string>();
  for (const [weekKey, { weekStart }] of weekMap) {
    const plan = await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: { userId, weekStart, status: "DRAFT", mode },
      update: { status: "DRAFT", mode },
    });
    planIdByWeek.set(weekKey, plan.id);
  }

  // Clear existing PROPOSED slots from all affected plans before filling
  await prisma.weeklyPlanSlot.deleteMany({
    where: { planId: { in: [...planIdByWeek.values()] }, status: "PROPOSED" },
  });

  if (mode === "DUMB") {
    const [candidates, connectedPlatforms] = await Promise.all([
      getCandidatePosts(userId),
      getConnectedPlatforms(userId),
    ]);

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "No candidate posts available to recycle" },
        { status: 400 }
      );
    }

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
  const [candidates, history, tagDist, connectedPlatforms] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
    getConnectedPlatforms(userId),
  ]);

  if (candidates.length < slotGrid.length) {
    return NextResponse.json(
      { error: `Not enough candidate posts (need at least ${slotGrid.length})` },
      { status: 400 }
    );
  }

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

  // Track cost so the admin $ meter picks it up
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

  const rawPicks = parseAiPicks(toolUse.input as { picks: AiPickResult[] });

  // Validate: postId must be in candidate pool; day+hour must match a grid position
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
