import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC, utcDateString } from "@/lib/planner/week";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import Anthropic from "@anthropic-ai/sdk";
import {
  getCandidatePosts,
  getVideoCandidatePosts,
  getRecentPublishHistory,
  getTagDistribution,
} from "@/lib/planner/candidates";
import {
  getEligiblePlatforms,
  type SlotGroup,
} from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import {
  buildPlannerSystemPrompt,
  PLANNER_TOOLS,
  parseAiPicks,
} from "@/lib/planner/prompt";
import { priceForUsage } from "@/lib/assistant/cost";
import type { AiPickResult, CandidatePost } from "@/lib/planner/types";

const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56; // 8 weeks safety valve

const VIDEO_PLATFORM_NAMES = ["YOUTUBE", "TIKTOK"] as const;

interface SlotPosition {
  day: Date;
  dayKey: string;
  hour: number;
  weekStart: Date;
  weekStartKey: string;
}

async function buildSlotGrid(
  userId: string,
  numSlots: number,
  slotGroup: SlotGroup,
): Promise<SlotPosition[]> {
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const horizon = new Date(todayUTC.getTime() + MAX_LOOK_AHEAD_DAYS * DAY_MS);

  // Collect hours already locked by SCHEDULED or APPROVED slots in this group
  const takenSlots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["SCHEDULED", "APPROVED"] },
      day: { gte: todayUTC, lte: horizon },
      slotGroup,
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

async function upsertPlansForGrid(
  userId: string,
  grid: SlotPosition[],
  mode: "AI" | "DUMB",
): Promise<Map<string, string>> {
  const planIdByWeek = new Map<string, string>();
  const seen = new Set<string>();
  for (const pos of grid) {
    if (seen.has(pos.weekStartKey)) continue;
    seen.add(pos.weekStartKey);
    const plan = await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart: pos.weekStart } },
      create: { userId, weekStart: pos.weekStart, status: "DRAFT", mode },
      update: { status: "DRAFT", mode },
    });
    planIdByWeek.set(pos.weekStartKey, plan.id);
  }
  return planIdByWeek;
}

async function fillSlotsDumb(
  grid: SlotPosition[],
  candidates: CandidatePost[],
  connectedPlatforms: string[],
  slotGroup: SlotGroup,
  planIdByWeek: Map<string, string>,
  reasoning: string,
  /**
   * `dayKey -> Set<postId>` of posts already pinned to a slot on that day in
   * a PRIOR pass (e.g. MAIN). The current pass skips candidates whose id is
   * already on the same day so the `@@unique([planId, day, postId])`
   * constraint doesn't fire when MAIN and VIDEO queues both pick the same
   * video as their freshest candidate.
   */
  usedByDay?: Map<string, Set<string>>,
): Promise<{ day: string; hour: number; postId: string }[]> {
  const picks: { day: string; hour: number; postId: string }[] = [];
  // Fewer candidates than slot positions is fine — fill what we can and leave
  // remaining slots empty. The VIDEO queue is naturally smaller and frequently
  // doesn't fill the full grid; that's acceptable.
  let candidateIdx = 0;
  for (let i = 0; i < grid.length && candidateIdx < candidates.length; i++) {
    const pos = grid[i];
    const dayUsed = usedByDay?.get(pos.dayKey);

    // Advance the candidate cursor past any post already pinned to this day
    // by an earlier pass (defends against MAIN+VIDEO selecting the same #1
    // candidate).
    while (
      candidateIdx < candidates.length &&
      dayUsed?.has(candidates[candidateIdx].id)
    ) {
      candidateIdx++;
    }
    if (candidateIdx >= candidates.length) break;

    const candidate = candidates[candidateIdx];
    const platforms = getEligiblePlatforms(
      candidate.mediaTypes,
      connectedPlatforms,
      slotGroup,
    );
    if (platforms.length === 0) {
      candidateIdx++;
      continue;
    }
    const planId = planIdByWeek.get(pos.weekStartKey)!;

    await prisma.weeklyPlanSlot.create({
      data: {
        planId,
        postId: candidate.id,
        day: pos.day,
        hour: pos.hour,
        status: "PROPOSED",
        reasoning,
        platforms,
        slotGroup,
      },
    });
    picks.push({ day: pos.dayKey, hour: pos.hour, postId: candidate.id });
    candidateIdx++;
  }
  return picks;
}

function buildUsedByDay(
  picks: { day: string; postId: string }[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const p of picks) {
    let set = map.get(p.day);
    if (!set) {
      set = new Set();
      map.set(p.day, set);
    }
    set.add(p.postId);
  }
  return map;
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

  const [mainGrid, videoGrid, connectedPlatforms] = await Promise.all([
    buildSlotGrid(userId, numSlots, "MAIN"),
    buildSlotGrid(userId, numSlots, "VIDEO"),
    getConnectedPlatforms(userId),
  ]);
  if (mainGrid.length === 0) {
    return NextResponse.json(
      { error: "No available slots in the next 8 weeks" },
      { status: 400 },
    );
  }

  const hasVideoPlatform = connectedPlatforms.some((p) =>
    (VIDEO_PLATFORM_NAMES as readonly string[]).includes(p),
  );
  const effectiveVideoGrid = hasVideoPlatform ? videoGrid : [];

  const planIdByWeek = await upsertPlansForGrid(
    userId,
    [...mainGrid, ...effectiveVideoGrid],
    mode,
  );

  // Clear existing PROPOSED slots in each group separately so a MAIN regenerate
  // doesn't blow away VIDEO proposals (and vice versa).
  await prisma.weeklyPlanSlot.deleteMany({
    where: {
      planId: { in: [...planIdByWeek.values()] },
      status: "PROPOSED",
      slotGroup: "MAIN",
    },
  });
  if (effectiveVideoGrid.length > 0) {
    await prisma.weeklyPlanSlot.deleteMany({
      where: {
        planId: { in: [...planIdByWeek.values()] },
        status: "PROPOSED",
        slotGroup: "VIDEO",
      },
    });
  }

  // --- MAIN pass ---------------------------------------------------------
  if (mode === "DUMB") {
    const candidates = await getCandidatePosts(userId);

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "No candidate posts available to recycle" },
        { status: 400 },
      );
    }

    const picks = await fillSlotsDumb(
      mainGrid,
      candidates,
      connectedPlatforms,
      "MAIN",
      planIdByWeek,
      "Recycling oldest unpublished content",
    );

    // --- VIDEO pass (always DUMB) -------------------------------------------
    let videoPicks: { day: string; hour: number; postId: string }[] = [];
    if (effectiveVideoGrid.length > 0) {
      const videoCandidates = await getVideoCandidatePosts(userId);
      if (videoCandidates.length > 0) {
        videoPicks = await fillSlotsDumb(
          effectiveVideoGrid,
          videoCandidates,
          connectedPlatforms,
          "VIDEO",
          planIdByWeek,
          "Recycling oldest unpublished video to YT/TikTok",
          buildUsedByDay(picks),
        );
      }
    }

    return NextResponse.json({ mode: "DUMB", picks, videoPicks });
  }

  // AI mode for MAIN
  const [candidates, history, tagDist] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
  ]);

  if (candidates.length < mainGrid.length) {
    return NextResponse.json(
      { error: `Not enough candidate posts (need at least ${mainGrid.length})` },
      { status: 400 },
    );
  }

  const systemPrompt = buildPlannerSystemPrompt(
    candidates,
    history,
    tagDist,
    connectedPlatforms,
  );

  const slotLines = mainGrid
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
  const validGridKeys = new Set(mainGrid.map((p) => `${p.dayKey}:${p.hour}`));
  const validPicks = rawPicks.filter(
    (p) => candidateIds.has(p.postId) && validGridKeys.has(`${p.day}:${p.hour}`),
  );

  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  for (const pick of validPicks) {
    const candidate = candidateMap.get(pick.postId)!;
    const pos = mainGrid.find((p) => p.dayKey === pick.day && p.hour === pick.hour)!;
    const platforms = getEligiblePlatforms(
      candidate.mediaTypes,
      connectedPlatforms,
      "MAIN",
    );
    if (platforms.length === 0) continue;
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
        slotGroup: "MAIN",
      },
    });
  }

  // --- VIDEO pass (always DUMB, even in AI mode) -------------------------
  // Claude planning is overkill for a small homogeneous queue; saves tokens.
  let videoPicks: { day: string; hour: number; postId: string }[] = [];
  if (effectiveVideoGrid.length > 0) {
    const videoCandidates = await getVideoCandidatePosts(userId);
    if (videoCandidates.length > 0) {
      videoPicks = await fillSlotsDumb(
        effectiveVideoGrid,
        videoCandidates,
        connectedPlatforms,
        "VIDEO",
        planIdByWeek,
        "Recycling oldest unpublished video to YT/TikTok",
        buildUsedByDay(
          validPicks.map((p) => ({ day: p.day, postId: p.postId })),
        ),
      );
    }
  }

  return NextResponse.json({ mode: "AI", picks: validPicks, videoPicks });
}
