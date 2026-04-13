import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfWeek, format } from "date-fns";
import { PlannerDashboard } from "./PlannerDashboard";
import type { PlanSlotData, WeeklyPlanData } from "@/lib/planner/types";

export default async function DashboardPage() {
  const session = await auth();
  const userId = session!.user!.id!;

  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;

  const [totalPosts, published, scheduled, plan] = await Promise.all([
    prisma.post.count({ where: { userId } }),
    prisma.publishRecord.count({ where: { post: { userId }, status: "PUBLISHED" } }),
    prisma.publishRecord.count({
      where: { post: { userId }, status: "PENDING", scheduledAt: { not: null } },
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
                media: { select: { storageKey: true, mimeType: true }, take: 1 },
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
    const slots: PlanSlotData[] = plan.slots.map((s) => {
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
      stats={{ totalPosts, published, scheduled }}
    />
  );
}
