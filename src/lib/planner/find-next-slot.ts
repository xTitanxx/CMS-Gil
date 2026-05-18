import { prisma } from "@/lib/prisma";
import { getMondayUTC, utcDateString } from "./week";
import { FIXED_SLOT_HOURS } from "./slot-constants";
import { buildSlotDate } from "./fixed-slots";
import type { SlotGroup } from "./platform-assignment";

const DAY_MS = 86_400_000;
const MAX_LOOK_AHEAD_DAYS = 56;

const VIDEO_PLATFORM_NAMES = ["YOUTUBE", "TIKTOK"] as const;

function todayUTC(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
}

export interface NextOpenSlot {
  day: Date;
  dayKey: string;
  hour: number;
  weekStart: Date;
}

/**
 * Walks the planner's fixed slot grid forward from today and returns the first
 * slot (within the requested group) that's neither held by an active
 * WeeklyPlanSlot nor by a PENDING PublishRecord. Used by both the suggester
 * (`/api/planner/next-candidate`) and the post page's slot picker
 * (`/api/planner/next-slot`).
 *
 * "Taken" must be the union of WeeklyPlanSlots and PublishRecords — looking at
 * just plan slots misses orphan PublishRecords left behind by the previous
 * slot-overwrite bug, which causes the suggester to offer hours that 409 on
 * commit.
 *
 * Group scoping: MAIN and VIDEO slots occupy independent (day, hour) cells —
 * a MAIN slot at Tue 15:00 does not block a VIDEO slot at the same time.
 * PublishRecord occupancy is partitioned by platform: YT/TT records count
 * toward VIDEO occupancy; everything else toward MAIN.
 */
export async function findNextOpenSlot(
  userId: string,
  slotGroup: SlotGroup = "MAIN",
): Promise<NextOpenSlot | null> {
  const now = new Date();
  const start = todayUTC();
  const horizon = new Date(start.getTime() + MAX_LOOK_AHEAD_DAYS * DAY_MS);

  const [planSlots, publishRecords] = await Promise.all([
    prisma.weeklyPlanSlot.findMany({
      where: {
        plan: { userId },
        status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
        day: { gte: start, lte: horizon },
        slotGroup,
      },
      select: { day: true, hour: true },
    }),
    prisma.publishRecord.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { gte: start, lte: horizon },
        post: { userId },
        platform:
          slotGroup === "VIDEO"
            ? { in: [...VIDEO_PLATFORM_NAMES] }
            : { notIn: [...VIDEO_PLATFORM_NAMES] },
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
    // PublishRecord.scheduledAt is UTC; the slot key is Asia/Jerusalem wall
    // day + hour. Walk our slot grid until buildSlotDate(day, hour) matches
    // the record — that's the slot it holds. 56 days × 4 hours is cheap.
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
      // Slots are wall-clock in Asia/Jerusalem; never suggest one whose moment
      // has already passed (otherwise today's earlier hours keep showing up
      // after they're effectively unschedulable).
      if (buildSlotDate(day, hour).getTime() <= now.getTime()) continue;
      if (!occupied.has(`${dayKey}:${hour}`)) {
        return { day, dayKey, hour, weekStart: getMondayUTC(day) };
      }
    }
  }
  return null;
}
