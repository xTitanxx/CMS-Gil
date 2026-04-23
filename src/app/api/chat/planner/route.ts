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

  const textBlocks = response.content.filter((b) => b.type === "text");
  const toolBlocks = response.content.filter((b) => b.type === "tool_use");

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

        await prisma.weeklyPlanSlot.deleteMany({ where: { planId, day: new Date(pick.day) } });
        await prisma.weeklyPlanSlot.create({
          data: { planId, postId: pick.postId, day: new Date(pick.day), reasoning: pick.reasoning, platforms },
        });
      }
    } else if (block.name === "swap_day") {
      const { day, postId, reasoning } = input as { day: string; postId: string; reasoning: string };
      const candidate = candidateMap.get(postId);
      const platforms = candidate
        ? getEligiblePlatforms(candidate.mediaTypes, connectedPlatforms)
        : [];

      await prisma.weeklyPlanSlot.deleteMany({ where: { planId, day: new Date(day) } });
      await prisma.weeklyPlanSlot.create({
        data: { planId, postId, day: new Date(day), reasoning, platforms },
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

      await prisma.weeklyPlanSlot.deleteMany({ where: { planId, day: new Date(day) } });
      await prisma.weeklyPlanSlot.create({
        data: { planId, postId, day: new Date(day), reasoning, platforms },
      });
    }
  }

  const text = textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("\n");

  return NextResponse.json({
    text,
    toolCalls: toolResults,
  });
}
