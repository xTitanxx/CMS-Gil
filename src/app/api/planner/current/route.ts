import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, format } from "date-fns";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });

  // Find or create the WeeklyPlan for this user+weekStart
  let plan = await prisma.weeklyPlan.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    include: {
      slots: {
        include: {
          post: {
            select: {
              id: true,
              body: true,
              tags: true,
              originalDate: true,
              publishCount: true,
              media: { select: { storageKey: true, mimeType: true }, take: 1 },
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
  });

  if (!plan) {
    plan = await prisma.weeklyPlan.create({
      data: { userId, weekStart },
      include: {
        slots: {
          include: {
            post: {
              select: {
                id: true,
                body: true,
                tags: true,
                originalDate: true,
                publishCount: true,
                media: { select: { storageKey: true, mimeType: true }, take: 1 },
              },
            },
          },
          orderBy: { day: "asc" },
        },
      },
    });
  }

  const slots: PlanSlotData[] = plan.slots
    .filter((s) => s.status !== "SKIPPED")
    .map((s) => {
      const firstMedia = s.post.media[0];
      const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);

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
            s.post.publishes[0]?.publishedAt &&
              s.post.publishes[0].publishedAt > s.post.originalDate
              ? s.post.publishes[0].publishedAt
              : s.post.originalDate,
            "yyyy-MM-dd"
          ),
          thumbUrl,
          hasVideo: s.post.media.some((m) => m.mimeType.startsWith("video/")),
        },
      };
    });

  const result: WeeklyPlanData = {
    id: plan.id,
    weekStart: format(plan.weekStart, "yyyy-MM-dd"),
    status: plan.status as WeeklyPlanData["status"],
    slots,
  };

  return NextResponse.json(result);
}
