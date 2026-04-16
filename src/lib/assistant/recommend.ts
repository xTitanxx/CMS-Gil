import type { CandidateRow, Recommendation, RecommendOptions } from "./types";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { currentSeason, seasonFit } from "./season";

export const WEIGHTS = {
  rating: 1.0,
  fitness: 0.9,
  freshness: 0.6,
  variety: 0.4,
  diversity: 0.3,
} as const;

const STAR_SCORE: Record<number, number> = {
  1: -0.4,
  2: -0.1,
  3: 0.2,
  4: 0.6,
  5: 1.0,
};

export interface ScoringContext {
  recentTags: string[][];                           // tags of last N publishes
  recentKinds: string[];                            // kinds of last 3 publishes
  negativeReasonFrequency: Map<string, number>;     // how often each negative reason appears across all ratings
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scorePost(
  post: CandidateRow,
  when: Date,
  ctx: ScoringContext,
): Recommendation {
  // Rating
  const ratingRaw = post.stars == null ? 0.15 : STAR_SCORE[post.stars] ?? 0;
  const ratingScore = ratingRaw * WEIGHTS.rating;

  // Lifecycle fit
  let fitRaw = 0;
  if (post.lifecycle === "EVERGREEN") fitRaw = 1.0;
  else if (post.lifecycle === "EPHEMERAL") fitRaw = -0.8;
  else if (post.lifecycle === "UNKNOWN") fitRaw = 0.2;
  else if (post.lifecycle === "SEASONAL" && post.season) {
    fitRaw = seasonFit(currentSeason(when), post.season);
  }
  const lifecycleFit = fitRaw * WEIGHTS.fitness;

  // Freshness
  let freshnessRaw: number;
  if (!post.lastPublishedAt) {
    freshnessRaw = 1.0;
  } else {
    // 30-day months: ~1.4% error at 24mo — negligible on the smooth exp curve.
    const months =
      (when.getTime() - post.lastPublishedAt.getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    freshnessRaw = 1 - Math.exp(-months / 24);
  }
  const freshness = freshnessRaw * WEIGHTS.freshness;

  // Tag variety: ranges [0, WEIGHTS.variety]. Full overlap → 0 (no reward);
  // zero overlap → full WEIGHTS.variety. A "reward floor of 0", not a penalty.
  const jaccardSum = ctx.recentTags.reduce(
    (s, t) => s + jaccard(post.tags, t),
    0,
  );
  const avgJaccard = ctx.recentTags.length ? jaccardSum / ctx.recentTags.length : 0;
  const tagVariety = (1 - avgJaccard) * WEIGHTS.variety;

  // Kind diversity
  const last3SameKind =
    ctx.recentKinds.length >= 3 &&
    ctx.recentKinds.slice(0, 3).every((k) => k === post.postType);
  const kindDiversity = (last3SameKind ? -1 : 0) * WEIGHTS.diversity;

  // Negative-reason penalty: 0.15 per reason that appears on ≥3 peers
  const penaltyReasons = post.ratingReasons.reduce(
    (s, r) => ((ctx.negativeReasonFrequency.get(r) ?? 0) >= 3 ? s + 0.15 : s),
    0,
  );

  const total =
    ratingScore + lifecycleFit + freshness + tagVariety + kindDiversity - penaltyReasons;

  // Human-readable reasons
  const reasons: string[] = [];
  if (post.stars != null) reasons.push(`${post.stars}★`);
  if (post.lifecycle === "EVERGREEN") reasons.push("evergreen");
  if (post.lifecycle === "SEASONAL" && post.season) {
    reasons.push(
      fitRaw === 1
        ? `in-season (${post.season.toLowerCase()})`
        : `seasonal (${post.season.toLowerCase()})`,
    );
  }
  if (freshnessRaw > 0.8) reasons.push("rarely reposted");
  if (last3SameKind) reasons.push("same kind × 3 recent");

  return {
    postId: post.id,
    score: total,
    breakdown: {
      ratingScore,
      lifecycleFit,
      freshness,
      tagVariety,
      kindDiversity,
      penaltyReasons,
      total,
    },
    reasons,
    body: post.body,
    tags: post.tags,
    stars: post.stars,
    lifecycle: post.lifecycle,
    thumbUrl: post.thumbUrl,
  };
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

const RECENCY_DAYS = 90;
const RECENT_HISTORY_N = 10;

export async function recommend(opts: RecommendOptions): Promise<Recommendation[]> {
  const when = opts.when ?? new Date();
  const cutoff = subDays(when, RECENCY_DAYS);
  const limit = opts.limit ?? 10;

  const [posts, recentPublishes, negativeReasonRows] = await Promise.all([
    prisma.post.findMany({
      where: {
        userId: opts.userId,
        readiness: "READY",
        share: { equals: Prisma.DbNull },
        ...(opts.kind ? { postType: opts.kind } : {}),
        ...(opts.excludePostIds?.length ? { NOT: { id: { in: opts.excludePostIds } } } : {}),
        publishes: {
          none: {
            OR: [
              { status: "PUBLISHED", publishedAt: { gte: cutoff } },
              { status: "PENDING", scheduledAt: { gte: when } },
            ],
          },
        },
      },
      select: {
        id: true,
        body: true,
        tags: true,
        originalDate: true,
        lifecycle: true,
        season: true,
        postType: true,
        publishCount: true,
        rating: { select: { stars: true, reasons: true } },
        publishes: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 1,
          select: { publishedAt: true },
        },
        media: {
          where: { mimeType: { startsWith: "image/" } },
          orderBy: { id: "asc" },
          take: 1,
          select: { storageKey: true, mimeType: true },
        },
      },
      orderBy: [{ publishCount: "asc" }, { originalDate: "asc" }],
      take: 200,
    }),
    prisma.publishRecord.findMany({
      where: { status: "PUBLISHED", post: { userId: opts.userId } },
      orderBy: { publishedAt: "desc" },
      take: RECENT_HISTORY_N,
      select: { post: { select: { tags: true, postType: true } } },
    }),
    prisma.$queryRaw<{ reason: string; count: bigint }[]>`
      SELECT unnest(r.reasons) AS reason, COUNT(*)::bigint AS count
      FROM "PostRating" r
      JOIN "Post" p ON p.id = r."postId"
      WHERE p."userId" = ${opts.userId}
      GROUP BY reason
    `.catch(() => [] as { reason: string; count: bigint }[]),
  ]);

  const rows = posts.map((p) => ({
    id: p.id,
    body: p.body,
    tags: p.tags,
    originalDate: p.originalDate,
    lifecycle: p.lifecycle,
    season: p.season,
    postType: p.postType,
    publishCount: p.publishCount,
    stars: p.rating?.stars ?? null,
    ratingReasons: p.rating?.reasons ?? [],
    lastPublishedAt: p.publishes[0]?.publishedAt ?? null,
    thumbUrl: buildThumbUrl(p.media[0]?.storageKey, p.media[0]?.mimeType),
  }));

  const recentTags = recentPublishes.map((r) => r.post.tags);
  const recentKinds = recentPublishes.map((r) => r.post.postType);

  const negativeReasonFrequency = new Map<string, number>();
  for (const row of negativeReasonRows as Array<{ reason: string; count: bigint }>) {
    negativeReasonFrequency.set(row.reason, Number(row.count));
  }

  const scored = rows.map((r) =>
    scorePost(r, when, { recentTags, recentKinds, negativeReasonFrequency }),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
