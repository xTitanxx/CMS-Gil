import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC, utcDateString } from "@/lib/planner/week";
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

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));
  const preferences: string | undefined = body.preferences;
  const mode: "AI" | "DUMB" = body.mode === "DUMB" ? "DUMB" : "AI";

  const weekStart = getMondayUTC();
  const days = Array.from({ length: 7 }, (_, i) =>
    utcDateString(new Date(weekStart.getTime() + i * 86400000))
  );

  if (mode === "DUMB") {
    const [candidates, platformTokens] = await Promise.all([
      getCandidatePosts(userId),
      prisma.platformToken.findMany({ where: { userId }, select: { platform: true } }),
    ]);

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "No candidate posts available to recycle" },
        { status: 400 }
      );
    }

    const connectedPlatforms = platformTokens.map((t) => t.platform as string);
    const picks = candidates.slice(0, 7);

    const plan = await prisma.weeklyPlan.upsert({
      where: { userId_weekStart: { userId, weekStart } },
      create: { userId, weekStart, status: "DRAFT", mode: "DUMB" },
      update: { status: "DRAFT", mode: "DUMB" },
    });

    await prisma.weeklyPlanSlot.deleteMany({
      where: { planId: plan.id, status: "PROPOSED" },
    });

    const created: { day: string; postId: string; reasoning: string }[] = [];
    for (let i = 0; i < picks.length; i++) {
      const candidate = picks[i];
      const platforms = getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms);
      const day = new Date(days[i] + "T00:00:00.000Z");
      const reasoning = "Recycling oldest unpublished content";

      await prisma.weeklyPlanSlot.create({
        data: {
          planId: plan.id,
          postId: candidate.id,
          day,
          status: "PROPOSED",
          reasoning,
          platforms,
        },
      });
      created.push({ day: days[i], postId: candidate.id, reasoning });
    }

    return NextResponse.json({ planId: plan.id, mode: "DUMB", picks: created });
  }

  // Parallel fetch all data needed
  const [candidates, history, tagDist, platformTokens] = await Promise.all([
    getCandidatePosts(userId),
    getRecentPublishHistory(userId),
    getTagDistribution(userId),
    prisma.platformToken.findMany({ where: { userId }, select: { platform: true } }),
  ]);

  if (candidates.length < 7) {
    return NextResponse.json(
      { error: "Not enough candidate posts (need at least 7)" },
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

  const userMessage = preferences
    ? `Plan my week. Preferences: ${preferences}\n\nDays to fill: ${days.join(", ")}`
    : `Plan my week.\n\nDays to fill: ${days.join(", ")}`;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: systemPrompt,
    tools: PLANNER_TOOLS,
    tool_choice: { type: "tool", name: "plan_week" },
    messages: [{ role: "user", content: userMessage }],
  });

  // Extract tool use block
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "AI did not return a plan" }, { status: 500 });
  }

  const rawPicks = parseAiPicks(toolUse.input as { picks: { day: string; postId: string; reasoning: string }[] });

  // Validate postIds against candidate pool
  const candidateIds = new Set(candidates.map((c) => c.id));
  const validPicks = rawPicks.filter((p) => candidateIds.has(p.postId));

  // Build a lookup for candidate media types
  const candidateMap = new Map(candidates.map((c) => [c.id, c]));

  // Upsert plan
  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart, status: "DRAFT", mode: "AI" },
    update: { status: "DRAFT", mode: "AI" },
  });

  // Delete existing PROPOSED slots
  await prisma.weeklyPlanSlot.deleteMany({
    where: { planId: plan.id, status: "PROPOSED" },
  });

  // Create new slots
  for (const pick of validPicks) {
    const candidate = candidateMap.get(pick.postId)!;
    const platforms = getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms);
    const day = new Date(pick.day + "T00:00:00.000Z");

    await prisma.weeklyPlanSlot.create({
      data: {
        planId: plan.id,
        postId: pick.postId,
        day,
        status: "PROPOSED",
        reasoning: pick.reasoning,
        platforms,
      },
    });
  }

  return NextResponse.json({ planId: plan.id, mode: "AI", picks: validPicks });
}
