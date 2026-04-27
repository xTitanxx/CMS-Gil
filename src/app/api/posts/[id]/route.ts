import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, deleteObject } from "@/lib/storage";
import { normalizeForSearch } from "@/lib/search-normalize";
import { refreshReadiness } from "@/lib/readiness-service";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { buildSlotDate } from "@/lib/planner/fixed-slots";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: { include: { audioTrack: { select: { id: true, title: true, storageKey: true } } } },
      publishes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      ...m,
      url: await getMediaUrl(m).catch(() => null),
    }))
  );

  // Surface the next planner placement so chat clients can show date+time and
  // offer cancel without a second round-trip. We prefer a real PublishRecord
  // when one exists (gives the precise scheduled time), and fall back to any
  // active WeeklyPlanSlot (PROPOSED/APPROVED/SCHEDULED) — for those we use the
  // slot's day at the first fixed hour as a sensible default.
  const todayMidnightUTC = new Date(Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  ));
  const upcomingSlot = await prisma.weeklyPlanSlot.findFirst({
    where: {
      postId: post.id,
      status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
      day: { gte: todayMidnightUTC },
    },
    orderBy: { day: "asc" },
    select: { id: true, planId: true, day: true, hour: true, status: true, platforms: true },
  });

  const nextPending = post.publishes
    .filter((p) => p.status === "PENDING" && p.scheduledAt && p.scheduledAt.getTime() > Date.now())
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];

  let nextScheduledAt: Date | null = nextPending?.scheduledAt ?? null;
  let nextSlotId: string | null = null;
  let nextPlanId: string | null = null;
  let nextSlotStatus: string | null = null;
  let nextSlotPlatforms: string[] = [];

  if (upcomingSlot) {
    nextSlotId = upcomingSlot.id;
    nextPlanId = upcomingSlot.planId;
    nextSlotStatus = upcomingSlot.status;
    nextSlotPlatforms = upcomingSlot.platforms;
    if (!nextScheduledAt) {
      // No PublishRecord yet — synthesize a UTC instant for the slot day at the
      // hour the assistant chose (or the first fixed slot hour as a default).
      nextScheduledAt = buildSlotDate(
        upcomingSlot.day,
        upcomingSlot.hour ?? FIXED_SLOT_HOURS[0],
      );
    }
  }

  return NextResponse.json({
    ...post,
    media: mediaWithUrls,
    nextScheduledAt: nextScheduledAt?.toISOString() ?? null,
    nextSlotId,
    nextPlanId,
    nextSlotStatus,
    nextSlotPlatforms,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const post = await prisma.post.updateMany({
    where: { id, userId: session.user.id },
    data: {
      ...(body.body !== undefined
        ? { body: body.body, bodyNormalized: normalizeForSearch(body.body) }
        : {}),
      ...(body.originalDate !== undefined
        ? { originalDate: new Date(body.originalDate) }
        : {}),
      ...(body.tags !== undefined && Array.isArray(body.tags)
        ? { tags: (body.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 50) }
        : {}),
      ...(body.postType !== undefined &&
        ["POST", "REEL", "STORY"].includes(body.postType)
        ? { postType: body.postType }
        : {}),
      ...(body.share !== undefined
        ? { share: body.share === null ? Prisma.DbNull : body.share }
        : {}),
      ...(body.platformUrl !== undefined
        ? {
            platformUrl:
              typeof body.platformUrl === "string" && body.platformUrl.trim()
                ? body.platformUrl.trim()
                : null,
          }
        : {}),
    },
  });

  if (post.count === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await refreshReadiness(id).catch((e) => console.error("readiness refresh failed", e));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: { media: true },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete media from storage
  for (const m of post.media) {
    await deleteObject(m.storageKey).catch(() => {});
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
