import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { subWeeks } from "date-fns";
import { getMondayUTC, utcDateString } from "@/lib/planner/week";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import { buildThumbUrl } from "@/lib/planner/thumbnail";

const RECENCY_WEEKS = 4;
const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56;

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

async function findNextOpenSlot(userId: string): Promise<{ day: Date; dayKey: string; hour: number; weekStart: Date } | null> {
  const start = todayUTC();
  const horizon = new Date(start.getTime() + MAX_LOOK_AHEAD_DAYS * DAY_MS);

  const taken = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
      day: { gte: start, lte: horizon },
    },
    select: { day: true, hour: true },
  });
  const occupied = new Set<string>();
  for (const s of taken) {
    if (s.hour != null) occupied.add(`${utcDateString(s.day)}:${s.hour}`);
  }

  for (let offset = 0; offset < MAX_LOOK_AHEAD_DAYS; offset++) {
    const day = new Date(start.getTime() + offset * DAY_MS);
    const dayKey = utcDateString(day);
    for (const hour of FIXED_SLOT_HOURS) {
      if (!occupied.has(`${dayKey}:${hour}`)) {
        return { day, dayKey, hour, weekStart: getMondayUTC(day) };
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const url = new URL(req.url);
  const excludeRaw = url.searchParams.get("exclude") ?? "";
  const exclude = excludeRaw ? excludeRaw.split(",").filter(Boolean) : [];

  const cutoff = subWeeks(new Date(), RECENCY_WEEKS);

  // Same gating as the bulk Recycle path: only original posts, with media,
  // not recently published or already pending elsewhere.
  const candidate = await prisma.post.findFirst({
    where: {
      userId,
      id: { notIn: exclude },
      media: { some: {} },
      share: { equals: Prisma.DbNull },
      originalDate: { lt: cutoff },
      publishes: {
        none: {
          OR: [
            { status: "PUBLISHED", publishedAt: { gte: cutoff } },
            { status: "PENDING", scheduledAt: { gte: new Date() } },
          ],
        },
      },
      // Exclude posts already pinned in any active plan slot
      planSlots: {
        none: { status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] } },
      },
    },
    select: {
      id: true,
      body: true,
      tags: true,
      originalDate: true,
      publishCount: true,
      lifecycle: true,
      season: true,
      postType: true,
      platformUrl: true,
      rating: { select: { stars: true } },
      media: {
        select: { id: true, mimeType: true, storageKey: true, hasAudio: true },
        orderBy: { createdAt: "asc" },
      },
      publishes: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
    orderBy: [{ publishCount: "asc" }, { originalDate: "asc" }],
  });

  if (!candidate) {
    return NextResponse.json({ candidate: null, remaining: 0 });
  }

  // Approximate remaining count for the queue indicator
  const remaining = await prisma.post.count({
    where: {
      userId,
      id: { notIn: exclude },
      media: { some: {} },
      share: { equals: Prisma.DbNull },
      originalDate: { lt: cutoff },
      publishes: {
        none: {
          OR: [
            { status: "PUBLISHED", publishedAt: { gte: cutoff } },
            { status: "PENDING", scheduledAt: { gte: new Date() } },
          ],
        },
      },
      planSlots: {
        none: { status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] } },
      },
    },
  });

  const slot = await findNextOpenSlot(userId);
  if (!slot) {
    return NextResponse.json({ candidate: null, remaining: 0, error: "No open slots in the next 8 weeks" });
  }

  const mediaTypes = candidate.media.map((m) => m.mimeType);
  const connected = await getConnectedPlatforms(userId);
  const platforms = getEligiblePlatforms(mediaTypes, connected);

  const firstMedia = candidate.media[0];
  const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);
  const lastPublishedAt =
    candidate.publishes[0]?.publishedAt && candidate.publishes[0].publishedAt > candidate.originalDate
      ? candidate.publishes[0].publishedAt
      : candidate.originalDate;

  return NextResponse.json({
    candidate: {
      id: candidate.id,
      body: candidate.body,
      tags: candidate.tags,
      originalDate: candidate.originalDate.toISOString(),
      lastPublishedAt: lastPublishedAt.toISOString(),
      publishCount: candidate.publishCount,
      lifecycle: candidate.lifecycle ?? "UNKNOWN",
      season: candidate.season ?? null,
      postType: candidate.postType ?? "POST",
      platformUrl: candidate.platformUrl ?? null,
      rating: candidate.rating?.stars ?? null,
      thumbUrl,
      hasVideo: candidate.media.some((m) => m.mimeType.startsWith("video/")),
      hasAudio: candidate.media.some((m) => m.hasAudio === true),
      media: candidate.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      })),
    },
    suggestedSlot: { day: slot.dayKey, hour: slot.hour },
    suggestedPlatforms: platforms,
    remaining,
  });
}
