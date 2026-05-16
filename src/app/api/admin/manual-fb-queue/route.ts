import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";

// Look back ~30 days for overdue slots, forward indefinitely. Past slots beyond
// this window are assumed to be stale backlog the user has implicitly skipped.
const LOOKBACK_DAYS = 30;
const MAX_RESULTS = 100;

export type QueueItem = {
  slotId: string;
  postId: string;
  scheduledAt: string;
  status: "SCHEDULED" | "APPROVED";
  reminderSentAt: string | null;
  body: string;
  platformUrl: string | null;
  media: { id: string; mimeType: string; url: string | null }[];
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // Slot.day is a UTC midnight per the planner; the real scheduled moment is
  // day + hour (Asia/Jerusalem). Fetch a day-level superset so we can compute
  // the exact moment in JS, then filter.
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
      status: true,
      day: true,
      hour: true,
      reminderSentAt: true,
      post: {
        select: {
          id: true,
          body: true,
          platformUrl: true,
          publishes: {
            where: { platform: "FACEBOOK", status: "PUBLISHED" },
            select: { id: true },
            take: 1,
          },
          media: {
            select: { id: true, mimeType: true, storageKey: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  const items: QueueItem[] = [];
  for (const slot of slots) {
    if (slot.post.publishes.length > 0) continue;

    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    const scheduledAt = buildSlotDate(slot.day, hour);
    if (scheduledAt < lookbackStart) continue;

    items.push({
      slotId: slot.id,
      postId: slot.post.id,
      scheduledAt: scheduledAt.toISOString(),
      status: slot.status as "SCHEDULED" | "APPROVED",
      reminderSentAt: slot.reminderSentAt?.toISOString() ?? null,
      body: slot.post.body ?? "",
      platformUrl: slot.post.platformUrl,
      media: slot.post.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      })),
    });
  }

  items.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  return NextResponse.json({
    items: items.slice(0, MAX_RESULTS),
    total: items.length,
  });
}
