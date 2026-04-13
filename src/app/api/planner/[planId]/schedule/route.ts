import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { setHours, setMinutes, setSeconds, setMilliseconds } from "date-fns";

type PlanStatus = "DRAFT" | "PARTIAL" | "APPROVED";

async function recalculatePlanStatus(planId: string): Promise<PlanStatus> {
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: { planId, status: { not: "SKIPPED" } },
    select: { status: true },
  });

  if (slots.length === 0) return "DRAFT";

  const allScheduled = slots.every(
    (s) => s.status === "SCHEDULED" || s.status === "APPROVED"
  );
  const anyScheduled = slots.some(
    (s) => s.status === "SCHEDULED" || s.status === "APPROVED"
  );

  if (allScheduled) return "APPROVED";
  if (anyScheduled) return "PARTIAL";
  return "DRAFT";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { planId } = await params;

  // Verify plan belongs to user
  const plan = await prisma.weeklyPlan.findUnique({
    where: { id: planId },
    select: { id: true, userId: true },
  });
  if (!plan || plan.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const slotIds: string[] | undefined = body.slotIds;

  // Fetch slots to schedule
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      planId,
      status: { in: ["PROPOSED", "APPROVED"] },
      ...(slotIds ? { id: { in: slotIds } } : {}),
    },
    select: {
      id: true,
      postId: true,
      day: true,
      platforms: true,
    },
  });

  let scheduled = 0;

  for (const slot of slots) {
    // Set scheduledAt to 9:00 AM on the slot's day
    const scheduledAt = setMilliseconds(
      setSeconds(setMinutes(setHours(slot.day, 9), 0), 0),
      0
    );

    // For each platform (excluding personal FACEBOOK)
    const platformsToSchedule = slot.platforms.filter((p) => p !== "FACEBOOK");

    for (const platform of platformsToSchedule) {
      // Cancel existing PENDING records for this post+platform
      await prisma.publishRecord.updateMany({
        where: {
          postId: slot.postId,
          platform: platform as never,
          status: "PENDING",
        },
        data: { status: "CANCELLED" },
      });

      // Create new PublishRecord
      await prisma.publishRecord.create({
        data: {
          postId: slot.postId,
          platform: platform as never,
          status: "PENDING",
          scheduledAt,
        },
      });
    }

    if (platformsToSchedule.length > 0) {
      await prisma.post.update({
        where: { id: slot.postId },
        data: { publishCount: { increment: 1 } },
      });
    }

    await prisma.weeklyPlanSlot.update({
      where: { id: slot.id },
      data: { status: "SCHEDULED" },
    });

    scheduled++;
  }

  // Update plan status
  const newStatus = await recalculatePlanStatus(planId);
  await prisma.weeklyPlan.update({
    where: { id: planId },
    data: { status: newStatus },
  });

  return NextResponse.json({ scheduled });
}
