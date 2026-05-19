import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";

const LOOKBACK_DAYS = 30;
const MAX_RESULTS = 100;

export type SubstackQueueItem = {
  slotId: string | null;
  postId: string;
  publishRecordId: string;
  scheduledAt: string;
  status: "SCHEDULED" | "APPROVED" | "AD_HOC";
  reminderSentAt: string | null;
  body: string;
  platformUrl: string | null;
  media: { id: string; mimeType: string; url: string | null }[];
};

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;

  const now = new Date();
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const lookbackDayKey = new Date(
    Date.UTC(
      lookbackStart.getUTCFullYear(),
      lookbackStart.getUTCMonth(),
      lookbackStart.getUTCDate() - 1,
    ),
  );

  // Planner-scheduled Substack slots.
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      plan: { userId },
      status: { in: ["APPROVED", "SCHEDULED"] },
      day: { gte: lookbackDayKey },
      platforms: { has: "SUBSTACK" },
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
            where: { platform: "SUBSTACK" },
            select: { id: true, status: true },
            orderBy: { createdAt: "desc" },
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

  const items: SubstackQueueItem[] = [];
  const seenPostIds = new Set<string>();
  for (const slot of slots) {
    const record = slot.post.publishes[0];
    if (!record || record.status === "PUBLISHED" || record.status === "CANCELLED") {
      continue;
    }
    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    const scheduledAt = buildSlotDate(slot.day, hour);
    if (scheduledAt < lookbackStart) continue;

    seenPostIds.add(slot.post.id);
    items.push({
      slotId: slot.id,
      postId: slot.post.id,
      publishRecordId: record.id,
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

  // Ad-hoc Substack publishes: rows pushed without going through the weekly
  // planner. Mirrors manual-fb-queue's adhoc branch.
  const adhocRecords = await prisma.publishRecord.findMany({
    where: {
      platform: "SUBSTACK",
      status: "PENDING",
      post: {
        userId,
        ...(seenPostIds.size > 0 ? { id: { notIn: [...seenPostIds] } } : {}),
      },
      createdAt: { gte: lookbackStart },
    },
    select: {
      id: true,
      scheduledAt: true,
      createdAt: true,
      post: {
        select: {
          id: true,
          body: true,
          platformUrl: true,
          media: {
            select: { id: true, mimeType: true, storageKey: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
    take: MAX_RESULTS,
  });

  for (const record of adhocRecords) {
    const moment = record.scheduledAt ?? record.createdAt;
    if (moment < lookbackStart) continue;
    items.push({
      slotId: null,
      postId: record.post.id,
      publishRecordId: record.id,
      scheduledAt: moment.toISOString(),
      status: "AD_HOC",
      reminderSentAt: null,
      body: record.post.body ?? "",
      platformUrl: record.post.platformUrl,
      media: record.post.media.map((m) => ({
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
