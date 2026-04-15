import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { subWeeks } from "date-fns";
import { buildThumbUrl } from "./thumbnail";
import type { CandidatePost } from "./types";

const RECENCY_WEEKS = 4;
const MAX_CANDIDATES = 200;

export async function getCandidatePosts(userId: string): Promise<CandidatePost[]> {
  const cutoff = subWeeks(new Date(), RECENCY_WEEKS);

  const posts = await prisma.post.findMany({
    where: {
      userId,
      media: { some: {} },
      // Exclude FB shares/crossposts — those were never original Gil content
      // (he was resurfacing someone else's post), so resurfacing them here
      // would republish material he doesn't own. `share` is a JSON column
      // populated by the FB-share parser; NULL means original post.
      share: { equals: Prisma.DbNull },
      // Posts in this DB were originally published on Facebook — treat originalDate
      // as the baseline "last posted" date. Skip anything posted (originally OR
      // recycled via the hub) within the recency window.
      originalDate: { lt: cutoff },
      publishes: {
        none: {
          OR: [
            { status: "PUBLISHED", publishedAt: { gte: cutoff } },
            { status: "PENDING", scheduledAt: { gte: new Date() } },
          ],
        },
      },
    },
    select: {
      id: true,
      body: true,
      tags: true,
      originalDate: true,
      publishCount: true,
      media: { select: { mimeType: true, storageKey: true }, take: 5 },
      publishes: {
        where: { status: "PUBLISHED" },
        orderBy: { publishedAt: "desc" },
        take: 1,
        select: { publishedAt: true },
      },
    },
    orderBy: [{ publishCount: "asc" }, { originalDate: "asc" }],
    take: MAX_CANDIDATES,
  });

  return posts.map((p) => {
    const mediaTypes = p.media.map((m) => m.mimeType);
    const firstMedia = p.media[0];
    const thumbUrl = buildThumbUrl(firstMedia?.storageKey, firstMedia?.mimeType);

    return {
      id: p.id,
      body: p.body,
      tags: p.tags,
      originalDate: p.originalDate,
      publishCount: p.publishCount,
      lastPublishedAt:
        p.publishes[0]?.publishedAt && p.publishes[0].publishedAt > p.originalDate
          ? p.publishes[0].publishedAt
          : p.originalDate,
      mediaTypes,
      hasVideo: mediaTypes.some((m) => m.startsWith("video/")),
      hasPhoto: mediaTypes.some((m) => m.startsWith("image/")),
      thumbUrl,
    };
  });
}

export async function getRecentPublishHistory(
  userId: string,
  weeks: number = 6
): Promise<{ tags: string[]; publishedAt: Date; postId: string }[]> {
  const cutoff = subWeeks(new Date(), weeks);

  const records = await prisma.publishRecord.findMany({
    where: {
      post: { userId },
      status: "PUBLISHED",
      publishedAt: { gte: cutoff },
    },
    select: {
      postId: true,
      publishedAt: true,
      post: { select: { tags: true } },
    },
    orderBy: { publishedAt: "desc" },
  });

  return records.map((r) => ({
    tags: r.post.tags,
    publishedAt: r.publishedAt!,
    postId: r.postId,
  }));
}

export async function getTagDistribution(
  userId: string
): Promise<Record<string, number>> {
  const posts = await prisma.post.findMany({
    where: { userId },
    select: { tags: true },
  });

  const counts: Record<string, number> = {};
  for (const p of posts) {
    for (const tag of p.tags) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }
  return counts;
}
