import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { format } from "date-fns";
import { PlannerDashboard } from "./PlannerDashboard";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { getMondayUTC } from "@/lib/planner/week";
import { FIXED_SLOT_HOURS } from "@/lib/planner/fixed-slots";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const weekStart = getMondayUTC();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const now = new Date();
  const [postedThisWeek, scheduled, plan] = await Promise.all([
    // "Posted this week" = real PublishRecord PUBLISHED in the last 7 days.
    // More actionable on the planner than a lifetime total.
    prisma.publishRecord.count({
      where: {
        post: { userId },
        status: "PUBLISHED",
        publishedAt: { gte: sevenDaysAgo },
      },
    }),
    // "Currently scheduled" = PENDING with a future scheduledAt. Past-due
    // PENDING records (cron not yet run) shouldn't inflate this.
    prisma.publishRecord.count({
      where: {
        post: { userId },
        status: "PENDING",
        scheduledAt: { gte: now },
      },
    }),
    prisma.weeklyPlan.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
      include: {
        slots: {
          where: { status: { not: "SKIPPED" } },
          include: {
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
                rating: { select: { stars: true } },
                media: { select: { storageKey: true, mimeType: true, hasAudio: true } },
                publishes: {
                  where: { status: "PUBLISHED" },
                  orderBy: { publishedAt: "desc" },
                  take: 1,
                  select: { publishedAt: true },
                },
              },
            },
          },
          orderBy: { day: "asc" },
        },
      },
    }),
  ]);

  let initialPlan: WeeklyPlanData | null = null;
  if (plan) {
    // Group slots by day so we can derive each slot's fixed-slot hour from its
    // index within the day (matches the schedule route's assignment).
    const slotsByDay = new Map<string, typeof plan.slots>();
    for (const s of plan.slots) {
      const dayKey = format(s.day, "yyyy-MM-dd");
      const arr = slotsByDay.get(dayKey) ?? [];
      arr.push(s);
      slotsByDay.set(dayKey, arr);
    }

    const slots: PlanSlotData[] = plan.slots.map((s) => {
      const firstMedia = s.post.media[0];
      const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
      const dayKey = format(s.day, "yyyy-MM-dd");
      const idx = (slotsByDay.get(dayKey) ?? [s]).indexOf(s);
      // Prefer the slot's stored hour (set by assistant proposals); fall back to
      // index-based assignment for legacy slots without one.
      const hour = s.hour ?? FIXED_SLOT_HOURS[idx] ?? null;

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
            s.post.publishes[0]?.publishedAt &&
              s.post.publishes[0].publishedAt > s.post.originalDate
              ? s.post.publishes[0].publishedAt
              : s.post.originalDate,
            "yyyy-MM-dd"
          ),
          thumbUrl,
          hasVideo: s.post.media.some((m) => m.mimeType.startsWith("video/")),
          lifecycle: (s.post.lifecycle ?? "UNKNOWN") as PlanSlotData["post"]["lifecycle"],
          season: (s.post.season ?? null) as PlanSlotData["post"]["season"],
          rating: s.post.rating?.stars ?? null,
          postType: (s.post.postType ?? "POST") as PlanSlotData["post"]["postType"],
          mediaCount: s.post.media.length,
          hasAudio: s.post.media.some((m) => m.hasAudio === true),
          platformUrl: s.post.platformUrl ?? null,
        },
      };
    });

    initialPlan = {
      id: plan.id,
      weekStart: format(plan.weekStart, "yyyy-MM-dd"),
      status: plan.status as WeeklyPlanData["status"],
      slots,
    };
  }

  return (
    <PlannerDashboard
      initialPlan={initialPlan}
      stats={{ scheduled, postedThisWeek }}
    />
  );
}
