import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { getMondayUTC } from "@/lib/planner/week";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

const SLOT_INCLUDE = {
  post: {
    select: {
      id: true,
      body: true,
      tags: true,
      originalDate: true,
      publishCount: true,
      lifecycle: true,
      season: true,
      postType: true,
      platformUrl: true,
      media: { select: { storageKey: true, mimeType: true, hasAudio: true } },
      rating: { select: { stars: true } },
      publishes: {
        where: { status: "PUBLISHED" as const },
        orderBy: { publishedAt: "desc" as const },
        take: 1,
        select: { publishedAt: true },
      },
    },
  },
} as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeSlot(s: any): PlanSlotData {
  const firstMedia = s.post.media[0];
  const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
  const lastPub = s.post.publishes?.[0]?.publishedAt;

  return {
    id: s.id,
    day: format(s.day, "yyyy-MM-dd"),
    postId: s.postId,
    status: s.status as PlanSlotData["status"],
    reasoning: s.reasoning,
    platforms: s.platforms,
    post: {
      id: s.post.id,
      body: s.post.body,
      tags: s.post.tags,
      originalDate: format(s.post.originalDate, "yyyy-MM-dd"),
      publishCount: s.post.publishCount,
      lastPublishedAt: format(
        lastPub && lastPub > s.post.originalDate ? lastPub : s.post.originalDate,
        "yyyy-MM-dd"
      ),
      thumbUrl,
      hasVideo: s.post.media.some((m: { mimeType: string }) => m.mimeType.startsWith("video/")),
      lifecycle: s.post.lifecycle ?? "UNKNOWN",
      season: s.post.season ?? null,
      rating: s.post.rating?.stars ?? null,
      postType: s.post.postType ?? "POST",
      mediaCount: s.post.media.length,
      hasAudio: s.post.media.some((m: { hasAudio?: boolean }) => m.hasAudio === true),
      platformUrl: s.post.platformUrl ?? null,
    },
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const weekStart = getMondayUTC();

  // Ensure current week plan exists
  await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart },
    update: {},
    select: { id: true },
  });

  // Fetch ALL plans for this user (covers past, current, and future weeks)
  const plans = await prisma.weeklyPlan.findMany({
    where: { userId },
    include: {
      slots: {
        where: { status: { not: "SKIPPED" } },
        include: SLOT_INCLUDE,
        orderBy: { day: "asc" },
      },
    },
    orderBy: { weekStart: "asc" },
  });

  // Merge all slots across all weeks into one flat array
  const allSlots: PlanSlotData[] = [];
  for (const plan of plans) {
    for (const s of plan.slots) {
      allSlots.push(serializeSlot(s));
    }
  }

  // Use the current week's plan as the primary record
  const currentPlan = plans.find(
    (p) => format(p.weekStart, "yyyy-MM-dd") === format(weekStart, "yyyy-MM-dd")
  ) ?? plans[0];

  const result: WeeklyPlanData = {
    id: currentPlan?.id ?? "",
    weekStart: format(weekStart, "yyyy-MM-dd"),
    status: (currentPlan?.status ?? "DRAFT") as WeeklyPlanData["status"],
    slots: allSlots,
  };

  return NextResponse.json(result);
}
