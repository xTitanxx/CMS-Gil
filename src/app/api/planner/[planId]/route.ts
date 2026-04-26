import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type PlanStatus = "DRAFT" | "PARTIAL" | "APPROVED";

async function recalculatePlanStatus(planId: string): Promise<PlanStatus> {
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: { planId, status: { not: "SKIPPED" } },
    select: { status: true },
  });

  if (slots.length === 0) return "DRAFT";

  const allApproved = slots.every((s) => s.status === "APPROVED" || s.status === "SCHEDULED");
  const anyApproved = slots.some((s) => s.status === "APPROVED" || s.status === "SCHEDULED");

  if (allApproved) return "APPROVED";
  if (anyApproved) return "PARTIAL";
  return "DRAFT";
}

export async function PATCH(
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

  const body = await req.json();
  const { action, slotId, postId, day, reasoning, platforms } = body as {
    action: "approve" | "remove" | "swap" | "pin";
    slotId?: string;
    postId?: string;
    day?: string;
    reasoning?: string;
    platforms?: string[];
  };

  switch (action) {
    case "approve": {
      if (!slotId) {
        return NextResponse.json({ error: "slotId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.updateMany({
        where: { id: slotId, planId },
        data: { status: "APPROVED" },
      });
      break;
    }

    case "remove": {
      if (!slotId) {
        return NextResponse.json({ error: "slotId required" }, { status: 400 });
      }
      // Look up the slot before mutating so we can also cancel any
      // PublishRecords created by quick-schedule. Without this, removing a
      // SCHEDULED slot only flips the planner UI — the post still publishes.
      const slot = await prisma.weeklyPlanSlot.findFirst({
        where: { id: slotId, planId },
        select: { postId: true, platforms: true, status: true },
      });
      await prisma.weeklyPlanSlot.updateMany({
        where: { id: slotId, planId },
        data: { status: "SKIPPED" },
      });
      if (slot && slot.status === "SCHEDULED" && slot.platforms.length > 0) {
        await prisma.publishRecord.updateMany({
          where: {
            postId: slot.postId,
            platform: { in: slot.platforms as never[] },
            status: "PENDING",
          },
          data: { status: "CANCELLED" },
        });
      }
      break;
    }

    case "swap": {
      if (!slotId || !postId) {
        return NextResponse.json({ error: "slotId and postId required" }, { status: 400 });
      }
      await prisma.weeklyPlanSlot.updateMany({
        where: { id: slotId, planId },
        data: {
          postId,
          reasoning: reasoning ?? null,
          platforms: platforms ?? [],
          status: "PROPOSED",
        },
      });
      break;
    }

    case "pin": {
      if (!postId || !day) {
        return NextResponse.json({ error: "postId and day required" }, { status: 400 });
      }
      const dayDate = new Date(day + "T00:00:00.000Z");
      // Remove any existing slot for this day, then create the new one
      await prisma.weeklyPlanSlot.deleteMany({
        where: { planId, day: dayDate },
      });
      await prisma.weeklyPlanSlot.create({
        data: {
          planId,
          postId,
          day: dayDate,
          status: "PROPOSED",
          reasoning: reasoning ?? null,
          platforms: platforms ?? [],
        },
      });
      break;
    }

    default:
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // Recalculate and update plan status
  const newStatus = await recalculatePlanStatus(planId);
  await prisma.weeklyPlan.update({
    where: { id: planId },
    data: { status: newStatus },
  });

  return NextResponse.json({ ok: true });
}
