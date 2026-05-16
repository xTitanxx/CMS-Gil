import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";

// Counts overdue manual-FB slots only — the sidebar badge should signal
// "you have backlog to clear", not "you have things upcoming today".
const LOOKBACK_DAYS = 30;

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackDayKey = new Date(
    Date.UTC(lookbackStart.getUTCFullYear(), lookbackStart.getUTCMonth(), lookbackStart.getUTCDate() - 1),
  );

  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["APPROVED", "SCHEDULED"] },
      day: { gte: lookbackDayKey },
    },
    select: {
      id: true,
      day: true,
      hour: true,
      post: {
        select: {
          publishes: {
            where: { platform: "FACEBOOK", status: { in: ["PUBLISHED", "CANCELLED"] } },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  let overdue = 0;
  for (const slot of slots) {
    if (slot.post.publishes.length > 0) continue;
    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    const scheduledAt = buildSlotDate(slot.day, hour);
    if (scheduledAt < lookbackStart) continue;
    if (scheduledAt <= now) overdue++;
  }

  return NextResponse.json({ overdue });
}
