import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC } from "@/lib/planner/week";
import { findNextAvailableSlot } from "@/lib/planner/fixed-slots";
import type { Platform } from "@prisma/client";

const PUBLISHABLE_PLATFORMS: Platform[] = [
  "INSTAGRAM",
  "FACEBOOK_PAGE",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
];

type PlanStatus = "DRAFT" | "PARTIAL" | "APPROVED";

async function recalculatePlanStatus(planId: string): Promise<PlanStatus> {
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: { planId, status: { not: "SKIPPED" } },
    select: { status: true },
  });
  if (slots.length === 0) return "DRAFT";
  const allScheduled = slots.every((s) => s.status === "SCHEDULED" || s.status === "APPROVED");
  const anyScheduled = slots.some((s) => s.status === "SCHEDULED" || s.status === "APPROVED");
  if (allScheduled) return "APPROVED";
  if (anyScheduled) return "PARTIAL";
  return "DRAFT";
}

function utcMidnightOf(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    select: { id: true, readiness: true },
  });
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });
  if (post.readiness !== "READY") {
    return NextResponse.json({ error: "post is not READY" }, { status: 400 });
  }

  // Connected publishing platforms (drop personal FACEBOOK; only what user has tokens for)
  const tokens = await prisma.platformToken.findMany({
    where: { userId, platform: { in: PUBLISHABLE_PLATFORMS } },
    select: { platform: true },
  });
  const platforms = tokens.map((t) => t.platform);
  if (platforms.length === 0) {
    return NextResponse.json(
      { error: "no publishing platforms connected" },
      { status: 400 },
    );
  }

  // Quick-schedule stays a single-slot, all-eligible-platforms shortcut — it's
  // the "I want this out the door now" path, not the planner. The MAIN/VIDEO
  // queue split is for /api/planner/generate. Slot group=MAIN with whatever
  // platforms have tokens (incl. YT/TT if the post is a video the platform
  // accepts; the publish layer rejects on the platform side if not).
  const scheduledAt = await findNextAvailableSlot(userId, new Date(), "MAIN");
  const dayDate = utcMidnightOf(scheduledAt);
  const weekStart = getMondayUTC(dayDate);

  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart },
    update: {},
    select: { id: true },
  });

  // Cancel any existing PENDING records for this post on these platforms
  await prisma.publishRecord.updateMany({
    where: {
      postId: post.id,
      platform: { in: platforms },
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });

  const slot = await prisma.weeklyPlanSlot.upsert({
    where: { planId_day_postId: { planId: plan.id, day: dayDate, postId: post.id } },
    create: {
      planId: plan.id,
      postId: post.id,
      day: dayDate,
      status: "SCHEDULED",
      platforms,
      slotGroup: "MAIN",
    },
    update: {
      status: "SCHEDULED",
      platforms,
      slotGroup: "MAIN",
    },
    select: { id: true },
  });

  await Promise.all(
    platforms.map((platform) =>
      prisma.publishRecord.create({
        data: {
          postId: post.id,
          platform,
          scheduledAt,
          status: "PENDING",
        },
      }),
    ),
  );

  await prisma.post.update({
    where: { id: post.id },
    data: { publishCount: { increment: 1 } },
  });

  const newStatus = await recalculatePlanStatus(plan.id);
  await prisma.weeklyPlan.update({
    where: { id: plan.id },
    data: { status: newStatus },
  });

  return NextResponse.json({
    ok: true,
    scheduledAt: scheduledAt.toISOString(),
    slotId: slot.id,
    planId: plan.id,
    platforms,
  });
}
