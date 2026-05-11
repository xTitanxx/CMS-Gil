import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { getMondayUTC } from "@/lib/planner/week";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { FIXED_SLOT_HOURS, SCHEDULE_TZ } from "@/lib/planner/fixed-slots";
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
function serializeSlot(s: any, hour: number | null): PlanSlotData {
  const firstMedia = s.post.media[0];
  const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
  const lastPub = s.post.publishes?.[0]?.publishedAt;

  return {
    id: s.id,
    day: format(s.day, "yyyy-MM-dd"),
    hour,
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
        // Stable order so derived slot index matches schedule-route ordering
        orderBy: [{ day: "asc" }, { id: "asc" }],
      },
    },
    orderBy: { weekStart: "asc" },
  });

  // For SCHEDULED slots, look up the matching PublishRecord to get the actual
  // publish time. Otherwise the time is derived from slot index (fixed slots
  // 12/15/18/21 in order). Batch into one query.
  const scheduledPostIds = new Set<string>();
  for (const plan of plans) {
    for (const s of plan.slots) {
      if (s.status === "SCHEDULED") scheduledPostIds.add(s.postId);
    }
  }
  const scheduledTimes = scheduledPostIds.size
    ? await prisma.publishRecord.findMany({
        where: {
          postId: { in: [...scheduledPostIds] },
          status: { in: ["PENDING", "PUBLISHED", "PROCESSING"] },
          scheduledAt: { not: null },
        },
        select: { postId: true, scheduledAt: true },
        orderBy: { scheduledAt: "asc" },
      })
    : [];
  // Map from postId|YYYY-MM-DD (UTC) → first matching scheduledAt
  const scheduledByPostDay = new Map<string, Date>();
  for (const r of scheduledTimes) {
    if (!r.scheduledAt) continue;
    const dayKey = r.scheduledAt.toISOString().slice(0, 10);
    const key = `${r.postId}|${dayKey}`;
    if (!scheduledByPostDay.has(key)) scheduledByPostDay.set(key, r.scheduledAt);
  }

  // Merge all slots across all weeks into one flat array
  const allSlots: PlanSlotData[] = [];
  for (const plan of plans) {
    // Derive hour-of-day per slot. Group by day, assign FIXED_SLOT_HOURS by
    // index. SCHEDULED slots prefer the actual PublishRecord scheduledAt hour.
    const byDay = new Map<string, typeof plan.slots>();
    for (const s of plan.slots) {
      const dayKey = format(s.day, "yyyy-MM-dd");
      const arr = byDay.get(dayKey) ?? [];
      arr.push(s);
      byDay.set(dayKey, arr);
    }
    for (const s of plan.slots) {
      const dayKey = format(s.day, "yyyy-MM-dd");
      const daySlots = byDay.get(dayKey) ?? [s];
      const idx = daySlots.indexOf(s);
      // Prefer the explicit hour stored on the slot (set by the suggester /
      // assistant when proposing). Fall back to FIXED_SLOT_HOURS-by-index for
      // legacy slots saved before `hour` existed — otherwise a single slot at
      // 18:00 would render as 12:00 because index 0 was always mapped to 12.
      let hour: number | null = s.hour ?? FIXED_SLOT_HOURS[idx] ?? null;
      if (s.status === "SCHEDULED") {
        const at = scheduledByPostDay.get(`${s.postId}|${dayKey}`);
        if (at) {
          hour = Number(formatInTimeZone(at, SCHEDULE_TZ, "H"));
        }
      }
      allSlots.push(serializeSlot(s, hour));
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
    mode: (currentPlan?.mode ?? "AI") as WeeklyPlanData["mode"],
    slots: allSlots,
  };

  return NextResponse.json(result);
}
