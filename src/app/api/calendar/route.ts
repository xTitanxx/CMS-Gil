import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThumbnailUrl } from "@/lib/storage";
import { formatScheduledTime, formatSlotHour } from "@/lib/planner/format-slot";
import { FIXED_SLOT_HOURS } from "@/lib/planner/fixed-slots";

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  // Dates are treated as UTC day boundaries. Callers should pass the user's
  // local calendar date (YYYY-MM-DD) — posts near midnight may shift by timezone.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: "start and end must be valid YYYY-MM-DD dates" }, { status: 400 });
  }
  const userId = session.user.id;

  const [publishRecords, importedPosts, planSlots] = await Promise.all([
    prisma.publishRecord.findMany({
      where: {
        post: { userId },
        OR: [
          { status: "PENDING", scheduledAt: { gte: startDate, lte: endDate } },
          { status: "PUBLISHED", publishedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        post: { include: { media: { take: 1 } } },
      },
    }),
    prisma.post.findMany({
      where: {
        userId,
        source: "FACEBOOK",
        originalDate: { gte: startDate, lte: endDate },
        publishes: { none: {} },
      },
      include: { media: { take: 1 } },
    }),
    prisma.weeklyPlanSlot.findMany({
      where: {
        plan: { userId },
        day: { gte: startDate, lte: endDate },
        status: { in: ["PROPOSED", "APPROVED"] },
      },
      include: {
        post: { include: { media: { take: 1 } } },
      },
    }),
  ]);

  // Group publish records by postId+date+status so a post published to
  // multiple platforms the same day collapses into one entry with a
  // platforms[] array.
  type GroupedEntry = {
    postId: string;
    date: string;
    time: string | null;
    status: "PENDING" | "PUBLISHED" | "IMPORTED" | "PROPOSED" | "PLAN_APPROVED";
    platforms: string[];
    thumbUrl: string | null;
    body: string;
    /** PublishRecord ids — only populated for PENDING entries so the day
     *  panel can offer per-entry cancellation. */
    publishRecordIds?: string[];
    _storageKey?: string;
    _mimeType?: string;
  };

  const groups = new Map<string, GroupedEntry>();

  for (const r of publishRecords) {
    const date = r.status === "PUBLISHED" ? r.publishedAt! : r.scheduledAt!;
    const dateKey = toDateKey(date);
    const status = r.status as "PENDING" | "PUBLISHED";
    const groupKey = `${r.postId}|${dateKey}|${status}`;
    const existing = groups.get(groupKey);
    if (existing) {
      if (!existing.platforms.includes(r.platform)) {
        existing.platforms.push(r.platform);
      }
      if (status === "PENDING") {
        existing.publishRecordIds ??= [];
        existing.publishRecordIds.push(r.id);
      }
    } else {
      const media = r.post.media[0];
      groups.set(groupKey, {
        postId: r.postId,
        date: dateKey,
        time: formatScheduledTime(date),
        status,
        platforms: [r.platform],
        thumbUrl: null,
        body: r.post.body,
        publishRecordIds: status === "PENDING" ? [r.id] : undefined,
        _storageKey: media?.storageKey,
        _mimeType: media?.mimeType,
      });
    }
  }

  for (const p of importedPosts) {
    const dateKey = toDateKey(p.originalDate);
    const groupKey = `${p.id}|${dateKey}|IMPORTED`;
    const media = p.media[0];
    groups.set(groupKey, {
      postId: p.id,
      date: dateKey,
      time: null,
      status: "IMPORTED",
      platforms: [],
      thumbUrl: null,
      body: p.body,
      _storageKey: media?.storageKey,
      _mimeType: media?.mimeType,
    });
  }

  // Build a set of postId+date keys already covered by PublishRecords so we
  // don't show duplicate entries for plan slots whose post is already scheduled.
  const publishedPostDateKeys = new Set<string>();
  for (const [key] of groups) {
    const [postId, date] = key.split("|");
    publishedPostDateKeys.add(`${postId}|${date}`);
  }

  // Group plan slots by day so we can derive each slot's time from its index.
  const slotsByDay = new Map<string, typeof planSlots>();
  for (const slot of planSlots) {
    const dateKey = toDateKey(slot.day);
    const arr = slotsByDay.get(dateKey) ?? [];
    arr.push(slot);
    slotsByDay.set(dateKey, arr);
  }

  for (const slot of planSlots) {
    const dateKey = toDateKey(slot.day);
    // Skip if this post already has a PublishRecord entry on the same day
    if (publishedPostDateKeys.has(`${slot.postId}|${dateKey}`)) continue;
    const slotStatus = slot.status === "APPROVED" ? "PLAN_APPROVED" : "PROPOSED";
    const groupKey = `${slot.postId}|${dateKey}|${slotStatus}`;
    // Only add if not already present (prefer higher-priority status if duplicate)
    if (!groups.has(groupKey)) {
      const media = slot.post.media[0];
      const idx = (slotsByDay.get(dateKey) ?? [slot]).indexOf(slot);
      const hour = FIXED_SLOT_HOURS[idx] ?? null;
      groups.set(groupKey, {
        postId: slot.postId,
        date: dateKey,
        time: hour != null ? formatSlotHour(hour) : null,
        status: slotStatus,
        platforms: [],
        thumbUrl: null,
        body: slot.post.body,
        _storageKey: media?.storageKey,
        _mimeType: media?.mimeType,
      });
    }
  }

  const entries = await Promise.all(
    Array.from(groups.values()).map(async (g) => {
      const thumbUrl = g._storageKey
        ? await getThumbnailUrl(g._storageKey, g._mimeType).catch(() => null)
        : null;
      return {
        postId: g.postId,
        date: g.date,
        time: g.time,
        status: g.status,
        platforms: g.platforms,
        thumbUrl,
        body: g.body,
        publishRecordIds: g.publishRecordIds,
      };
    })
  );

  return NextResponse.json({ entries });
}
