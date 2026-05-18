import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEligiblePlatforms } from "@/lib/planner/platform-assignment";
import { getConnectedPlatforms } from "@/lib/connected-platforms";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { findNextOpenSlot } from "@/lib/planner/find-next-slot";
import {
  getSuggesterCandidateWhere,
  SUGGESTER_ORDER_BY,
} from "@/lib/planner/suggester-filter";

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

  // Suggester is MAIN-only: it surfaces the next post + slot for the photo/text
  // queue. YT/TT are filled by the automatic VIDEO pass in the planner.
  const slot = await findNextOpenSlot(userId, "MAIN");
  if (!slot) {
    return NextResponse.json({ candidate: null, remaining: 0, error: "No open slots in the next 8 weeks" });
  }

  const mediaTypes = candidate.media.map((m) => m.mimeType);
  const connected = await getConnectedPlatforms(userId);
  const platforms = getEligiblePlatforms(mediaTypes, connected, "MAIN");

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
