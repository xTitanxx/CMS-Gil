import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCandidatePosts } from "@/lib/planner/candidates";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import { buildSlotDate } from "@/lib/planner/fixed-slots";

type PlanStatus = "DRAFT" | "PARTIAL" | "APPROVED";

const RECYCLE_REASONING = "Recycling oldest unpublished content";

async function slideAndRefillFromIndex(
  planId: string,
  userId: string,
  rejectedPostId: string,
  slots: Array<{ id: string; postId: string; platforms: string[] }>,
  idx: number
) {
  // Slide: copy slots[i+1] onto slots[i] for i from idx to len-2.
  for (let i = idx; i < slots.length - 1; i++) {
    const src = slots[i + 1];
    await prisma.weeklyPlanSlot.update({
      where: { id: slots[i].id },
      data: {
        postId: src.postId,
        platforms: src.platforms,
        reasoning: RECYCLE_REASONING,
        status: "PROPOSED",
      },
    });
  }

  const lastSlot = slots[slots.length - 1];
  const usedPostIds = new Set(slots.slice(0, slots.length - 1).map((s) => s.postId));

  // Exclude posts already pinned in this user's other DRAFT/PARTIAL plans
  const adjacentSlots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId, status: { in: ["DRAFT", "PARTIAL"] } },
      status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
      NOT: { planId },
    },
    select: { postId: true },
  });
  for (const s of adjacentSlots) usedPostIds.add(s.postId);

  const candidates = await getCandidatePosts(userId);
  const refill = candidates.find(
    (c) => !usedPostIds.has(c.id) && c.id !== rejectedPostId
  );

  if (refill) {
    const connectedPlatforms = await getConnectedPlatforms(userId);
    const platforms = getEligiblePlatforms(refill.mediaTypes, connectedPlatforms);

    await prisma.weeklyPlanSlot.update({
      where: { id: lastSlot.id },
      data: {
        postId: refill.id,
        platforms,
        reasoning: RECYCLE_REASONING,
        status: "PROPOSED",
      },
    });
  } else {
    // No candidates left — mark the trailing slot SKIPPED so the gap is visible.
    await prisma.weeklyPlanSlot.update({
      where: { id: lastSlot.id },
      data: { status: "SKIPPED" },
    });
  }
}

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
    select: { id: true, userId: true, mode: true },
  });
  if (!plan || plan.userId !== userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json();
  const { action, slotId, postId, day, reasoning, platforms } = body as {
    action: "approve" | "remove" | "swap" | "pin" | "clear";
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
      if (!slot) break;

      if (slot.status === "SCHEDULED" && slot.platforms.length > 0) {
        await prisma.publishRecord.updateMany({
          where: {
            postId: slot.postId,
            platform: { in: slot.platforms as never[] },
            status: "PENDING",
          },
          data: { status: "CANCELLED" },
        });
      }

      if (plan.mode === "DUMB" && slot.status !== "SCHEDULED") {
        // Recycle queue: shift subsequent slots up and pull the next-oldest
        // candidate into the trailing slot. SCHEDULED slots stay parked
        // (their PublishRecords are real); falls through to SKIPPED below.
        const slidableSlots = await prisma.weeklyPlanSlot.findMany({
          where: { planId, status: { in: ["PROPOSED", "APPROVED"] } },
          orderBy: { day: "asc" },
          select: { id: true, postId: true, platforms: true },
        });
        const idx = slidableSlots.findIndex((s) => s.id === slotId);
        if (idx !== -1) {
          await slideAndRefillFromIndex(
            planId,
            plan.userId,
            slot.postId,
            slidableSlots,
            idx
          );
          break;
        }
      }

      await prisma.weeklyPlanSlot.updateMany({
        where: { id: slotId, planId },
        data: { status: "SKIPPED" },
      });
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

    case "clear": {
      // Clear PROPOSED/APPROVED plan slots. Also undo SCHEDULED slots whose
      // matching PublishRecord is still PENDING (i.e. nothing has actually
      // gone out yet) — the suggester writes SCHEDULED directly, so without
      // this the button silently leaves committed-but-unpublished slots in
      // place.
      const scheduledSlots = await prisma.weeklyPlanSlot.findMany({
        where: { planId, status: "SCHEDULED" },
        select: { id: true, postId: true, day: true, hour: true },
      });

      for (const s of scheduledSlots) {
        if (s.hour == null) continue;
        const scheduledAt = buildSlotDate(s.day, s.hour);
        const cancelled = await prisma.publishRecord.updateMany({
          where: {
            postId: s.postId,
            status: "PENDING",
            scheduledAt,
          },
          data: { status: "CANCELLED" },
        });
        // Undo the optimistic publishCount bump that schedule:true did up
        // front, so the suggester's `orderBy: publishCount asc` doesn't push
        // cleared-but-never-sent posts to the back of the queue.
        if (cancelled.count > 0) {
          await prisma.post.update({
            where: { id: s.postId },
            data: { publishCount: { decrement: 1 } },
          });
        }
      }

      await prisma.weeklyPlanSlot.deleteMany({
        where: { planId, status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] } },
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
