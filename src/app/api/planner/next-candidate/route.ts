import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMondayUTC, utcDateString } from "@/lib/planner/week";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import {
  getSuggesterCandidateWhere,
  SUGGESTER_ORDER_BY,
} from "@/lib/planner/suggester-filter";

const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56;

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

async function findNextOpenSlot(userId: string): Promise<{ day: Date; dayKey: string; hour: number; weekStart: Date } | null> {
  const now = new Date();
  const start = todayUTC();
  const horizon = new Date(start.getTime() + MAX_LOOK_AHEAD_DAYS * DAY_MS);

  // "Taken" is the union of: active WeeklyPlanSlots and PENDING PublishRecords.
  // Looking only at WeeklyPlanSlots used to miss orphan PublishRecords left
  // behind by the earlier slot-overwrite bug — the suggester would offer
  // those hours, propose would 409, and the user got stuck in a retry loop.
  const [planSlots, publishRecords] = await Promise.all([
    prisma.weeklyPlanSlot.findMany({
      where: {
        plan: { userId },
        status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
        day: { gte: start, lte: horizon },
      },
      select: { day: true, hour: true },
    }),
    prisma.publishRecord.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { gte: start, lte: horizon },
        post: { userId },
      },
      select: { scheduledAt: true },
    }),
  ]);

  const occupied = new Set<string>();
  for (const s of planSlots) {
    if (s.hour != null) occupied.add(`${utcDateString(s.day)}:${s.hour}`);
  }
  for (const r of publishRecords) {
    if (!r.scheduledAt) continue;
    // The PublishRecord stores UTC; the slot key is the Asia/Jerusalem wall
    // day + hour. Walk our slot grid until we find the (dayKey, hour) whose
    // buildSlotDate matches scheduledAt — that's the slot this record holds.
    // 56 days × 4 hours is cheap.
    const target = r.scheduledAt.getTime();
    outer: for (let offset = 0; offset < MAX_LOOK_AHEAD_DAYS; offset++) {
      const day = new Date(start.getTime() + offset * DAY_MS);
      for (const hour of FIXED_SLOT_HOURS) {
        if (buildSlotDate(day, hour).getTime() === target) {
          occupied.add(`${utcDateString(day)}:${hour}`);
          break outer;
        }
      }
    }
  }

  for (let offset = 0; offset < MAX_LOOK_AHEAD_DAYS; offset++) {
    const day = new Date(start.getTime() + offset * DAY_MS);
    const dayKey = utcDateString(day);
    for (const hour of FIXED_SLOT_HOURS) {
      // Slots are wall-clock in Asia/Jerusalem; never suggest one whose
      // moment has already passed (otherwise today's earlier hours keep
      // showing up after they're effectively unschedulable).
      if (buildSlotDate(day, hour).getTime() <= now.getTime()) continue;
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

  // Shared with the "Suggester queue" sort on /admin/posts. Only excludes
  // NOT_READY/ARCHIVED posts; everything else flows through and is ordered by
  // publishCount asc then originalDate asc.
  const baseWhere = {
    ...getSuggesterCandidateWhere(userId),
    id: { notIn: exclude },
  };

  const candidate = await prisma.post.findFirst({
    where: baseWhere,
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
    orderBy: SUGGESTER_ORDER_BY,
  });

  if (!candidate) {
    return NextResponse.json({ candidate: null, remaining: 0 });
  }

  const remaining = await prisma.post.count({ where: baseWhere });

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
