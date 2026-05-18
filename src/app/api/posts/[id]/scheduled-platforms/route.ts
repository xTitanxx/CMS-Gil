import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { z } from "zod";
import { buildSlotDate } from "@/lib/planner/fixed-slots";
import { FIXED_SLOT_HOURS } from "@/lib/planner/slot-constants";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import {
  isPlatformEligible,
  mediaShapeFromMimeTypes,
} from "@/lib/platform-eligibility";

// Marker stored on slot.platforms to opt the slot into the manual-FB queue.
// Never written to PublishRecord — not a real Platform enum value.
const FB_PERSONAL_MARKER = "FACEBOOK_PERSONAL";

const ALLOWED_INPUT = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
  FB_PERSONAL_MARKER,
] as const;

const AUTO_PLATFORMS = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
] as const satisfies readonly Platform[];

const requestSchema = z.object({
  platforms: z.array(z.enum(ALLOWED_INPUT as unknown as [string, ...string[]])),
});

// "Most relevant slot" for this post: SCHEDULED beats APPROVED beats PROPOSED;
// within a status, latest day wins. Lets the picker target the active slot
// when a post happens to have stale slots in earlier weeks.
async function findRelevantSlot(postId: string, userId: string) {
  const slots = await prisma.weeklyPlanSlot.findMany({
    where: {
      postId,
      plan: { userId },
      status: { in: ["PROPOSED", "APPROVED", "SCHEDULED"] },
    },
    select: { id: true, day: true, hour: true, status: true, platforms: true },
  });
  const rank: Record<string, number> = { SCHEDULED: 0, APPROVED: 1, PROPOSED: 2 };
  slots.sort((a, b) => {
    const r = rank[a.status] - rank[b.status];
    if (r !== 0) return r;
    return b.day.getTime() - a.day.getTime();
  });
  return slots[0] ?? null;
}

/**
 * Reconcile the platform set for an already-scheduled post.
 *
 * Body: { platforms: ["FACEBOOK_PAGE", "INSTAGRAM", "FACEBOOK_PERSONAL", ...] }
 *
 * For each auto platform requested that has no in-flight PublishRecord,
 * create one at the slot's scheduled time. For each in-flight PublishRecord
 * whose platform isn't requested, cancel it. Sync `WeeklyPlanSlot.platforms`
 * (when a slot exists) so the snapshot used by the scheduled list and
 * manual-FB queue stays consistent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: postId } = await params;

  const parsed = requestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const requested = new Set(parsed.data.platforms);

  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    select: { id: true, media: { select: { mimeType: true } } },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const shape = mediaShapeFromMimeTypes(post.media.map((m) => m.mimeType));
  const connected = new Set(await getConnectedPlatforms(userId));

  // Drop platforms the user can't actually publish to. FB Personal marker
  // always passes (it's a UI marker for the manual queue, not a publisher).
  const filtered = new Set<string>();
  for (const p of requested) {
    if (p === FB_PERSONAL_MARKER) {
      filtered.add(p);
      continue;
    }
    if (!isPlatformEligible(p, shape)) continue;
    if (!connected.has(p)) continue;
    filtered.add(p);
  }

  const slot = await findRelevantSlot(postId, userId);

  // PROPOSED/APPROVED slots are pre-schedule intent — editing platforms
  // there only updates the snapshot. Actual PublishRecords are minted by the
  // "Schedule" action; creating them here would silently move the slot to
  // SCHEDULED without going through that flow.
  if (slot && (slot.status === "PROPOSED" || slot.status === "APPROVED")) {
    await prisma.weeklyPlanSlot.update({
      where: { id: slot.id },
      data: { platforms: [...filtered] },
    });
    return NextResponse.json({
      ok: true,
      platforms: [...filtered],
      created: [],
      cancelled: [],
      slotId: slot.id,
      mode: "snapshot-only",
    });
  }

  // From here on: SCHEDULED slot, or ad-hoc post with live PublishRecords.
  // Live PublishRecords for this post — what we reconcile against. Never
  // cancel PROCESSING; the lambda may still complete successfully.
  const live = await prisma.publishRecord.findMany({
    where: { postId, status: { in: ["PENDING", "PROCESSING"] } },
    select: { id: true, platform: true, status: true, scheduledAt: true },
  });

  let scheduledAt: Date | null = null;
  if (slot) {
    const hour = slot.hour ?? FIXED_SLOT_HOURS[0];
    scheduledAt = buildSlotDate(slot.day, hour);
  } else {
    const earliest = live
      .map((r) => r.scheduledAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    scheduledAt = earliest ?? null;
  }

  const autoTargets = new Set(
    [...filtered].filter((p): p is Platform =>
      (AUTO_PLATFORMS as readonly string[]).includes(p),
    ),
  );

  const livePending = live.filter((r) => r.status === "PENDING");
  const liveProcessingPlatforms = new Set(
    live.filter((r) => r.status === "PROCESSING").map((r) => r.platform),
  );

  const toCancel = livePending.filter((r) => !autoTargets.has(r.platform));
  const toCreate = [...autoTargets].filter(
    (p) =>
      !livePending.some((r) => r.platform === p) &&
      !liveProcessingPlatforms.has(p),
  );

  if (toCreate.length > 0 && !scheduledAt) {
    return NextResponse.json(
      { error: "cannot add platforms: post has no scheduled time" },
      { status: 400 },
    );
  }

  // Sequential awaits — pgbouncer transaction-pool times out $transaction.
  for (const r of toCancel) {
    await prisma.publishRecord.update({
      where: { id: r.id },
      data: { status: "CANCELLED" },
    });
  }
  for (const platform of toCreate) {
    await prisma.publishRecord.create({
      data: {
        postId,
        platform,
        status: "PENDING",
        scheduledAt: scheduledAt!,
      },
    });
  }

  if (slot) {
    await prisma.weeklyPlanSlot.update({
      where: { id: slot.id },
      data: { platforms: [...filtered] },
    });
  }

  return NextResponse.json({
    ok: true,
    platforms: [...filtered],
    created: toCreate,
    cancelled: toCancel.map((r) => r.platform),
    slotId: slot?.id ?? null,
  });
}

/**
 * Returns current canonical state for the platform picker: connected,
 * media-eligible, currently selected (union of slot snapshot + live records).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId },
    select: { id: true, media: { select: { mimeType: true } } },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [slot, live, connected] = await Promise.all([
    findRelevantSlot(postId, userId),
    prisma.publishRecord.findMany({
      where: { postId, status: { in: ["PENDING", "PROCESSING"] } },
      select: { platform: true, status: true },
    }),
    getConnectedPlatforms(userId),
  ]);

  const shape = mediaShapeFromMimeTypes(post.media.map((m) => m.mimeType));
  const eligibleByMedia = AUTO_PLATFORMS.filter((p) =>
    isPlatformEligible(p, shape),
  );

  const selected = new Set<string>([
    ...(slot?.platforms ?? []),
    ...live.map((r) => r.platform),
  ]);

  return NextResponse.json({
    ok: true,
    selected: [...selected],
    connected,
    eligibleByMedia,
    hasFbPersonalMarker: (slot?.platforms ?? []).includes(FB_PERSONAL_MARKER),
    livePlatforms: live.map((r) => ({ platform: r.platform, status: r.status })),
  });
}
