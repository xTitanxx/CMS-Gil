import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC } from "@/lib/planner/week";
import { buildSlotDate } from "@/lib/planner/fixed-slots";

const ALLOWED_PLATFORMS = new Set([
  "INSTAGRAM",
  "FACEBOOK_PAGE",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
  // UI-only marker. Stored on slot.platforms so the manual-fb queue and
  // push-reminders cron can opt in slots the user wants a reminder for.
  // Stripped from auto-publish below — it's not a real Platform enum value.
  "FACEBOOK_PERSONAL",
]);

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = (await req.json()) as {
    postId?: unknown;
    day?: unknown;
    hour?: unknown;
    platforms?: unknown;
    reasoning?: unknown;
    schedule?: unknown;
  };

  const postId = typeof body.postId === "string" ? body.postId : "";
  const day = typeof body.day === "string" ? body.day : "";
  if (!postId) return NextResponse.json({ error: "postId required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return NextResponse.json({ error: "day must be YYYY-MM-DD" }, { status: 400 });
  }

  const ALLOWED_HOURS = [12, 15, 18, 21];
  const hour =
    typeof body.hour === "number" && ALLOWED_HOURS.includes(body.hour) ? body.hour : null;

  const platforms = Array.isArray(body.platforms)
    ? (body.platforms as unknown[]).filter(
        (p): p is string => typeof p === "string" && ALLOWED_PLATFORMS.has(p),
      )
    : [];
  if (platforms.length === 0) {
    return NextResponse.json({ error: "platforms required" }, { status: 400 });
  }

  const reasoning = typeof body.reasoning === "string" ? body.reasoning : null;
  const scheduleNow = body.schedule === true;

  // schedule:true requires an explicit hour — we need it to compute scheduledAt.
  if (scheduleNow && hour == null) {
    return NextResponse.json(
      { error: "hour is required when schedule=true" },
      { status: 400 },
    );
  }

  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    select: { id: true },
  });
  if (!post) return NextResponse.json({ error: "post not found" }, { status: 404 });

  const dayDate = new Date(day + "T00:00:00.000Z");
  const weekStart = getMondayUTC(dayDate);

  const plan = await prisma.weeklyPlan.upsert({
    where: { userId_weekStart: { userId, weekStart } },
    create: { userId, weekStart },
    update: {},
    select: { id: true },
  });

  // schedule:true is the suggester's commit path — refuse to silently overwrite
  // another post that already lives in (planId, day, hour) or in the matching
  // PublishRecord. Without this, racing/stale clients overwrote prior accepts
  // (same slot got reused, prior PublishRecord left orphan PENDING). The
  // planner/assistant flow (schedule:false) keeps the original overwrite
  // semantics because it's user-driven editing of a plan, not a commit.
  if (scheduleNow && hour != null) {
    const scheduledAt = buildSlotDate(dayDate, hour);
    const [slotConflict, publishConflict] = await Promise.all([
      prisma.weeklyPlanSlot.findFirst({
        where: {
          planId: plan.id,
          day: dayDate,
          hour,
          postId: { not: postId },
          status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
        },
        select: { id: true, postId: true },
      }),
      prisma.publishRecord.findFirst({
        where: {
          status: "PENDING",
          scheduledAt,
          postId: { not: postId },
          post: { userId },
        },
        select: { id: true, postId: true },
      }),
    ]);
    if (slotConflict || publishConflict) {
      return NextResponse.json(
        {
          error: "slot already taken",
          conflict: slotConflict ?? publishConflict,
        },
        { status: 409 },
      );
    }
  }

  // Replace at the precise (day, hour) — keeps other slots on the same day
  // intact so the suggester can stack multiple posts per day. Also clear any
  // prior slot for this same post on this day so the
  // @@unique([planId, day, postId]) constraint doesn't fire when a post is
  // being moved to a different hour.
  if (hour != null) {
    await prisma.weeklyPlanSlot.deleteMany({
      where: {
        planId: plan.id,
        day: dayDate,
        OR: [{ hour }, { postId }],
      },
    });
  } else {
    // Legacy hour=null path (chat planner): one slot per day.
    await prisma.weeklyPlanSlot.deleteMany({
      where: { planId: plan.id, day: dayDate },
    });
  }

  const slot = await prisma.weeklyPlanSlot.create({
    data: {
      planId: plan.id,
      postId,
      day: dayDate,
      hour,
      status: scheduleNow ? "SCHEDULED" : "PROPOSED",
      reasoning,
      platforms,
    },
    select: { id: true },
  });

  if (scheduleNow && hour != null) {
    const scheduledAt = buildSlotDate(dayDate, hour);
    // FACEBOOK_PERSONAL is a UI-only marker for the manual queue + reminder
    // flow, not a real Platform enum value — drop it before creating
    // PublishRecords. Plain "FACEBOOK" is excluded as a belt-and-suspenders
    // guard against legacy data.
    const autoPlatforms = platforms.filter(
      (p) => p !== "FACEBOOK" && p !== "FACEBOOK_PERSONAL",
    );

    if (autoPlatforms.length > 0) {
      // Sequential awaits (no $transaction) — pgbouncer transaction-pool mode
      // times out on $transaction in this stack.
      for (const platform of autoPlatforms) {
        // Cancel any existing PENDING record for the same post+platform so a
        // second propose-with-schedule doesn't leave a duplicate scheduled job.
        await prisma.publishRecord.updateMany({
          where: {
            postId,
            platform: platform as never,
            status: "PENDING",
          },
          data: { status: "CANCELLED" },
        });

        await prisma.publishRecord.create({
          data: {
            postId,
            platform: platform as never,
            status: "PENDING",
            scheduledAt,
          },
        });
      }

      await prisma.post.update({
        where: { id: postId },
        data: { publishCount: { increment: 1 } },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    planId: plan.id,
    slotId: slot.id,
    scheduled: scheduleNow,
  });
}
