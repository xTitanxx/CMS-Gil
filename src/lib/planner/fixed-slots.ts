import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { FIXED_SLOT_HOURS, SCHEDULE_TZ } from "./slot-constants";

export { FIXED_SLOT_HOURS, SCHEDULE_TZ };

/** Build a UTC `Date` for `hour:00` on `dayInTZ` (a date interpreted as Asia/Jerusalem). */
export function buildSlotDate(dayInTZ: Date, hour: number): Date {
  const ymd = formatInTimeZone(dayInTZ, SCHEDULE_TZ, "yyyy-MM-dd");
  const hh = String(hour).padStart(2, "0");
  return fromZonedTime(`${ymd} ${hh}:00:00`, SCHEDULE_TZ);
}

/** Returns the next 12/15/18/21 (Asia/Jerusalem) datetime that has no PENDING
 *  PublishRecord at exactly that scheduledAt for any of the user's posts.
 *  Searches up to 14 days forward. */
export async function findNextAvailableSlot(
  userId: string,
  fromDate: Date = new Date(),
): Promise<Date> {
  const SEARCH_DAYS = 14;
  const horizon = new Date(fromDate.getTime() + SEARCH_DAYS * 24 * 60 * 60 * 1000);

  const taken = await prisma.publishRecord.findMany({
    where: {
      status: "PENDING",
      post: { userId },
      scheduledAt: { gte: fromDate, lte: horizon },
    },
    select: { scheduledAt: true },
  });
  const takenSet = new Set(
    taken.map((r) => r.scheduledAt?.getTime()).filter((t): t is number => typeof t === "number"),
  );

  for (let dayOffset = 0; dayOffset < SEARCH_DAYS; dayOffset++) {
    const dayInTZ = new Date(fromDate.getTime() + dayOffset * 24 * 60 * 60 * 1000);
    for (const hour of FIXED_SLOT_HOURS) {
      const candidate = buildSlotDate(dayInTZ, hour);
      if (candidate.getTime() <= fromDate.getTime()) continue;
      if (takenSet.has(candidate.getTime())) continue;
      return candidate;
    }
  }

  throw new Error(`No free slot in next ${SEARCH_DAYS} days`);
}
