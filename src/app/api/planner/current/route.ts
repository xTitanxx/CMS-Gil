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
function serializeSlot(s: any, hour: number | null, published: boolean): PlanSlotData {
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
    published,
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
        select: { postId: true, scheduledAt: true, status: true },
        orderBy: { scheduledAt: "asc" },
      })
    : [];
  // Map from postId|YYYY-MM-DD (UTC) → first matching scheduledAt.
  // Track published-ness separately so the client can grey out today's
  // already-fired slots without re-deriving from raw records.
  const scheduledByPostDay = new Map<string, Date>();
  const publishedByPostDay = new Set<string>();
  for (const r of scheduledTimes) {
    if (!r.scheduledAt) continue;
    const dayKey = r.scheduledAt.toISOString().slice(0, 10);
    const key = `${r.postId}|${dayKey}`;
    if (!scheduledByPostDay.has(key)) scheduledByPostDay.set(key, r.scheduledAt);
    if (r.status === "PUBLISHED") publishedByPostDay.add(key);
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
      let published = false;
      if (s.status === "SCHEDULED") {
        const recordKey = `${s.postId}|${dayKey}`;
        const at = scheduledByPostDay.get(recordKey);
        if (at) {
          hour = Number(formatInTimeZone(at, SCHEDULE_TZ, "H"));
        }
        published = publishedByPostDay.has(recordKey);
      }
      allSlots.push(serializeSlot(s, hour, published));
    }
  }

  // Synthesize "virtual" slots for PublishRecords that don't have a backing
  // WeeklyPlanSlot — e.g. a post scheduled directly from /admin/posts/[id]
  // via PublishPanel. Without this, those posts only show up in the calendar
  // and never in the planner, and there's no way to cancel them from here.
  //
  // Build a coverage set of (postId|day) already represented by a real slot
  // (any status) so a post that has both a slot AND a PublishRecord still
  // collapses to one entry — the slot wins because it carries plan-level
  // metadata (reasoning, hour, scheduled status).
  const slotPostDays = new Set<string>();
  for (const plan of plans) {
    for (const s of plan.slots) {
      slotPostDays.add(`${s.postId}|${format(s.day, "yyyy-MM-dd")}`);
    }
  }

  const now = new Date();
  const orphanRecords = await prisma.publishRecord.findMany({
    where: {
      post: { userId },
      status: "PENDING",
      scheduledAt: { not: null, gte: now },
    },
    include: { post: { select: SLOT_INCLUDE.post.select } },
    orderBy: { scheduledAt: "asc" },
  });

  // Group records that share the same post + same timestamp (a single
  // post-page Schedule click creates one record per platform, all stamped
  // with the identical scheduledAt). Each group becomes one virtual slot
  // with platforms[] aggregated and recordIds[] for cancellation.
  type Orphan = (typeof orphanRecords)[number];
  const virtualGroups = new Map<
    string,
    {
      scheduledAt: Date;
      postId: string;
      platforms: string[];
      recordIds: string[];
      post: Orphan["post"];
    }
  >();
  for (const r of orphanRecords) {
    if (!r.scheduledAt) continue;
    // Day-key via `format()` (same as the slot serializer) so dedup with
    // slotPostDays compares apples to apples — `toISOString` is UTC and would
    // disagree with `format` near day boundaries.
    const dayKey = format(r.scheduledAt, "yyyy-MM-dd");
    if (slotPostDays.has(`${r.postId}|${dayKey}`)) continue;
    // Bucket on the full ISO timestamp (millisecond precision is fine —
    // platform records made in the same loop share the same Date object).
    const key = `${r.postId}|${r.scheduledAt.toISOString()}`;
    const existing = virtualGroups.get(key);
    if (existing) {
      existing.recordIds.push(r.id);
      if (!existing.platforms.includes(r.platform)) existing.platforms.push(r.platform);
    } else {
      virtualGroups.set(key, {
        scheduledAt: r.scheduledAt,
        postId: r.postId,
        platforms: [r.platform],
        recordIds: [r.id],
        post: r.post,
      });
    }
  }

  for (const g of virtualGroups.values()) {
    const dayKey = format(g.scheduledAt, "yyyy-MM-dd");
    const hour = Number(formatInTimeZone(g.scheduledAt, SCHEDULE_TZ, "H"));
    const firstMedia = g.post.media[0];
    const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
    const lastPub = g.post.publishes?.[0]?.publishedAt;

    allSlots.push({
      // Synthetic id; the cancel path keys off publishRecordIds, not id, but
      // React keys still need uniqueness across slots.
      id: `publish:${g.recordIds.join(",")}`,
      day: dayKey,
      hour,
      postId: g.postId,
      status: "SCHEDULED",
      reasoning: null,
      platforms: g.platforms,
      published: false,
      publishRecordIds: g.recordIds,
      post: {
        id: g.post.id,
        body: g.post.body,
        tags: g.post.tags,
        originalDate: format(g.post.originalDate, "yyyy-MM-dd"),
        publishCount: g.post.publishCount,
        lastPublishedAt: format(
          lastPub && lastPub > g.post.originalDate ? lastPub : g.post.originalDate,
          "yyyy-MM-dd"
        ),
        thumbUrl,
        hasVideo: g.post.media.some((m) => m.mimeType.startsWith("video/")),
        lifecycle: (g.post.lifecycle ?? "UNKNOWN") as PlanSlotData["post"]["lifecycle"],
        season: (g.post.season ?? null) as PlanSlotData["post"]["season"],
        rating: g.post.rating?.stars ?? null,
        postType: (g.post.postType ?? "POST") as PlanSlotData["post"]["postType"],
        mediaCount: g.post.media.length,
        hasAudio: g.post.media.some((m) => m.hasAudio === true),
        platformUrl: g.post.platformUrl ?? null,
      },
    });
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
