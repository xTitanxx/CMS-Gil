import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, format } from "date-fns";
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

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  const slots: PlanSlotData[] = plan.slots
    .filter((s) => s.status !== "SKIPPED")
    .map((s) => {
      const firstMedia = s.post.media[0];
      const thumbUrl =
        firstMedia && cloudName
          ? `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_80,h_80/${firstMedia.storageKey.replace(/\.[^.]+$/, "")}`
          : null;

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
