import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { ManualFbQueueClient, type QueueItem } from "./ManualFbQueueClient";

export const metadata = { title: "Manual FB queue" };
export const dynamic = "force-dynamic";

const LOOKBACK_DAYS = 30;
const MAX_RESULTS = 100;

async function loadQueue(userId: string): Promise<QueueItem[]> {
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
  return items.slice(0, MAX_RESULTS);
}

export default async function ManualFbQueuePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/api/auth/signin?callbackUrl=/admin/manual-fb");

  const items = await loadQueue(session.user.id);
  return <ManualFbQueueClient initialItems={items} />;
}
