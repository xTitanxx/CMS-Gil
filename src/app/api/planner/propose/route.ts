import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC } from "@/lib/planner/week";

const ALLOWED_PLATFORMS = new Set([
  "INSTAGRAM",
  "FACEBOOK_PAGE",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
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
      status: "PROPOSED",
      reasoning,
      platforms,
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true, planId: plan.id, slotId: slot.id });
}
