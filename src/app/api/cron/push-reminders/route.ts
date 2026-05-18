import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { sendPushToUser } from "@/lib/push/web-push";
import { fromZonedTime } from "date-fns-tz";
import { SCHEDULE_TZ } from "@/lib/planner/slot-constants";

// How far ahead of slot time we want the reminder to fire.
const REMINDER_LEAD_MIN = 15;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Pull all active slots that haven't fired a reminder yet. Filtering by
  // (day, hour) in SQL is awkward because slot times live in IL local time,
  // not UTC — so we fetch a small window of upcoming days and decide in JS.
  // The cron runs every 5 min and slots are 4/day, so the working set is tiny.
  const lookbackDays = 1;
  const lookaheadDays = 2;
  const startDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - lookbackDays));
  const endDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + lookaheadDays));

  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      status: { in: ["APPROVED", "SCHEDULED"] },
      reminderSentAt: null,
      hour: { not: null },
      day: { gte: startDay, lte: endDay },
      // Opt-in: only slots where the user picked the FB Personal chip get a
      // push reminder. Mirrors the manual-fb-queue filter.
      platforms: { has: "FACEBOOK_PERSONAL" },
    },
    include: {
      plan: { select: { userId: true } },
      post: { select: { id: true, body: true } },
    },
  });

  const fired: Array<{ slotId: string; userId: string; results: number }> = [];

  for (const slot of slots) {
    if (slot.hour == null) continue;

    // Compute the actual UTC publish time. Slot.day is stored as a UTC
    // midnight DateTime; combine with the IL-local hour to get the real moment.
    const dayStr = slot.day.toISOString().slice(0, 10);
    const hh = String(slot.hour).padStart(2, "0");
    const localIso = `${dayStr}T${hh}:00:00`;
    const slotUtc = fromZonedTime(localIso, SCHEDULE_TZ);

    const minutesUntil = (slotUtc.getTime() - now.getTime()) / 60_000;
    // Fire when we're within the lead window (and not already past it by
    // more than the cron interval — give a 6-min trailing buffer to handle
    // jitter without missing any).
    if (minutesUntil > REMINDER_LEAD_MIN || minutesUntil < -6) continue;

    const bodyPreview = (slot.post.body ?? "").replace(/\s+/g, " ").trim().slice(0, 90);

    const results = await sendPushToUser(slot.plan.userId, {
      title: "Time to post on Facebook",
      body: bodyPreview ? `${bodyPreview}…` : "A scheduled slot is coming up.",
      url: `/admin/m/${slot.post.id}?slot=${slot.id}&from=/admin/manual-fb`,
      tag: `slot-${slot.id}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    });

    await prisma.weeklyPlanSlot.update({
      where: { id: slot.id },
      data: { reminderSentAt: new Date() },
    });

    fired.push({ slotId: slot.id, userId: slot.plan.userId, results: results.filter((r) => r.success).length });
  }

  return NextResponse.json({ scanned: slots.length, fired: fired.length, details: fired });
}
