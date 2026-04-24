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

  // Group slots by day so we can space them equally
  const slotsByDay = new Map<string, typeof slots>();
  for (const slot of slots) {
    const dayKey = slot.day.toISOString().slice(0, 10);
    const arr = slotsByDay.get(dayKey) ?? [];
    arr.push(slot);
    slotsByDay.set(dayKey, arr);
  }

  // Posting window: 9:00 AM – 9:00 PM (12 hours)
  const WINDOW_START_HOUR = 9;
  const WINDOW_END_HOUR = 21;

  let scheduled = 0;

  for (const slot of slots) {
    // Find this slot's position among same-day slots
    const dayKey = slot.day.toISOString().slice(0, 10);
    const daySlots = slotsByDay.get(dayKey) ?? [slot];
    const idx = daySlots.indexOf(slot);
    const count = daySlots.length;

    // Space equally across the posting window
    let hour: number;
    let minute: number;
    if (count === 1) {
      hour = WINDOW_START_HOUR;
      minute = 0;
    } else {
      const totalMinutes = (WINDOW_END_HOUR - WINDOW_START_HOUR) * 60;
      const offsetMinutes = Math.round((idx * totalMinutes) / (count - 1));
      hour = WINDOW_START_HOUR + Math.floor(offsetMinutes / 60);
      minute = offsetMinutes % 60;
      // Round to nearest 30 min
      minute = Math.round(minute / 30) * 30;
      if (minute === 60) { hour++; minute = 0; }
    }

    const scheduledAt = setMilliseconds(
      setSeconds(setMinutes(setHours(slot.day, hour), minute), 0),
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
