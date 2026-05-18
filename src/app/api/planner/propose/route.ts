import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC } from "@/lib/planner/week";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { inferSlotGroup } from "@/lib/planner/platform-assignment";

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

const VIDEO_PLATFORM_NAMES = ["YOUTUBE", "TIKTOK"] as const;

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

  // Slots are now group-scoped: MAIN (FB Page / IG / LinkedIn / FACEBOOK_PERSONAL)
  // and VIDEO (YT / TikTok) live in independent (day, hour) cells so video-only
  // platforms can cycle their own queue. Reject mixed calls — the caller (chat
  // tool, planner UI) must split into one propose per group.
  const slotGroup = inferSlotGroup(
    platforms.filter((p) => p !== "FACEBOOK_PERSONAL"),
  );
  if (slotGroup === null) {
    return NextResponse.json(
      {
        error:
          "mixed-group platforms not allowed — call propose once with MAIN platforms (FACEBOOK_PAGE/INSTAGRAM/LINKEDIN) and again with VIDEO platforms (YOUTUBE/TIKTOK)",
      },
      { status: 400 },
    );
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
  // The DB still enforces `@@unique([planId, day, postId])` (kept for prod
  // rollout compat) — same post can't be pinned to both MAIN and VIDEO on the
  // same day. Surface a clean 409 if the caller is trying to.
  const crossGroupConflict = await prisma.weeklyPlanSlot.findFirst({
    where: {
      planId: plan.id,
      day: dayDate,
      postId,
      slotGroup: { not: slotGroup },
      status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
    },
    select: { id: true, slotGroup: true, hour: true },
  });
  if (crossGroupConflict) {
    return NextResponse.json(
      {
        error: `post already pinned to ${crossGroupConflict.slotGroup} on this day — pick a different day or remove the other slot first`,
        conflict: crossGroupConflict,
      },
      { status: 409 },
    );
  }

  if (scheduleNow && hour != null) {
    const scheduledAt = buildSlotDate(dayDate, hour);
    const [slotConflict, publishConflict] = await Promise.all([
      prisma.weeklyPlanSlot.findFirst({
        where: {
          planId: plan.id,
          day: dayDate,
          hour,
          postId: { not: postId },
          slotGroup,
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
          platform:
            slotGroup === "VIDEO"
              ? { in: [...VIDEO_PLATFORM_NAMES] }
              : { notIn: [...VIDEO_PLATFORM_NAMES] },
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

  // Replace at the precise (day, hour, slotGroup) — keeps other slots on the
  // same day intact (other hours AND the other group at the same hour) so the
  // suggester can stack multiple posts per day and the two queues stay
  // independent. Also clear any prior same-group slot for this post on this
  // day so the @@unique([planId, day, postId, slotGroup]) constraint doesn't
  // fire when a post is being moved to a different hour within the group.
  if (hour != null) {
    await prisma.weeklyPlanSlot.deleteMany({
      where: {
        planId: plan.id,
        day: dayDate,
        slotGroup,
        OR: [{ hour }, { postId }],
      },
    });
  } else {
    // Legacy hour=null path (chat planner): one slot per day per group.
    await prisma.weeklyPlanSlot.deleteMany({
      where: { planId: plan.id, day: dayDate, slotGroup },
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
      slotGroup,
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
