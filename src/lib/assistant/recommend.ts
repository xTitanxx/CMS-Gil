import type { CandidateRow, Recommendation, RecommendOptions } from "./types";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { classifyContent } from "./classify";
import { currentSeason, seasonFit } from "./season";

export const WEIGHTS = {
  rating: 1.0,
  fitness: 0.9,
  freshness: 0.6,
  topicRecency: 0.7,
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
  tagLastSeen: Map<string, Date>;                   // most recent publish date per tag (across the user's whole history) — drives "stale topic" boost
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
  // Rating — unrated posts get a slight negative to prefer rated content
  const ratingRaw = post.stars == null ? -0.15 : STAR_SCORE[post.stars] ?? 0;
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

  // Freshness — never-published posts get a moderate score, not the maximum
  let freshnessRaw: number;
  if (!post.lastPublishedAt) {
    freshnessRaw = 0.6;
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

  // Topic recency: prioritise posts whose topics (tags) the user hasn't covered
  // in a long time. For each tag on the candidate, look up the most recent
  // publish date for ANY post carrying that tag, then take the staleness of
  // the *most stale* tag (so a single neglected topic is enough to surface
  // the post). Tags never published score full staleness (1.0).
  let topicStaleness = 0;
  for (const tag of post.tags) {
    const lastSeen = ctx.tagLastSeen.get(tag);
    let s: number;
    if (!lastSeen) {
      s = 1;
    } else {
      const days = (when.getTime() - lastSeen.getTime()) / (1000 * 60 * 60 * 24);
      // ~30d → 0.63, ~90d → 0.95, plateaus near 1.
      s = 1 - Math.exp(-Math.max(0, days) / 30);
    }
    if (s > topicStaleness) topicStaleness = s;
  }
  const topicRecency = topicStaleness * WEIGHTS.topicRecency;

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
    ratingScore + lifecycleFit + freshness + topicRecency + tagVariety + kindDiversity - penaltyReasons;

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
  if (!post.lastPublishedAt) reasons.push("never posted");
  else if (freshnessRaw > 0.8) reasons.push("rarely reposted");
  if (topicStaleness > 0.85) reasons.push("stale topic");
  if (last3SameKind) reasons.push("same kind × 3 recent");

  return {
    postId: post.id,
    score: total,
    breakdown: {
      ratingScore,
      lifecycleFit,
      freshness,
      tagVariety,
      topicRecency,
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
    contentKind: post.contentKind,
    platformUrl: post.platformUrl,
  };
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

const RECENCY_DAYS = 90;
const RECENT_HISTORY_N = 10;
const TOPIC_RECENCY_LOOKBACK_DAYS = 365;

export async function recommend(opts: RecommendOptions): Promise<Recommendation[]> {
  const when = opts.when ?? new Date();
  const cutoff = subDays(when, RECENCY_DAYS);
  const topicCutoff = subDays(when, TOPIC_RECENCY_LOOKBACK_DAYS);
  const limit = opts.limit ?? 10;

  const [posts, recentPublishes, negativeReasonRows, topicHistory] = await Promise.all([
    prisma.post.findMany({
      where: {
        userId: opts.userId,
        readiness: "READY",
        tags: { isEmpty: false }, // Exclude untagged posts — likely unprocessed or broken media
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
        platformUrl: true,
        rating: { select: { stars: true, reasons: true } },
        publishes: {
          where: { status: "PUBLISHED" },
          orderBy: { publishedAt: "desc" },
          take: 1,
          select: { publishedAt: true },
        },
        media: {
          orderBy: { id: "asc" },
          select: { storageKey: true, mimeType: true },
        },
      },
      orderBy: { publishCount: "asc" },
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
    // Last year of publishes — used to compute per-tag staleness for the
    // topic-recency boost. Tags absent from this list score full staleness.
    prisma.publishRecord.findMany({
      where: {
        status: "PUBLISHED",
        post: { userId: opts.userId },
        publishedAt: { gte: topicCutoff },
      },
      orderBy: { publishedAt: "desc" },
      select: {
        publishedAt: true,
        post: { select: { tags: true } },
      },
    }),
  ]);

  const rows: CandidateRow[] = posts.map((p) => {
    const mimes = p.media.map((m) => m.mimeType);
    const thumbSource = p.media.find((m) => m.mimeType.startsWith("image/")) ?? p.media[0];
    return {
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
      thumbUrl: buildThumbUrl(thumbSource?.storageKey, thumbSource?.mimeType),
      contentKind: classifyContent({ postType: p.postType, body: p.body, mediaMimes: mimes }),
      platformUrl: p.platformUrl,
    };
  });

  const recentTags = recentPublishes.map((r) => r.post.tags);
  const recentKinds = recentPublishes.map((r) => r.post.postType);

  const negativeReasonFrequency = new Map<string, number>();
  for (const row of negativeReasonRows as Array<{ reason: string; count: bigint }>) {
    negativeReasonFrequency.set(row.reason, Number(row.count));
  }

  // Build the per-tag last-published map. The query is ordered desc, so the
  // first time we see a tag we record the latest date and skip subsequent
  // older publishes of the same tag.
  const tagLastSeen = new Map<string, Date>();
  for (const r of topicHistory) {
    if (!r.publishedAt) continue;
    for (const tag of r.post.tags) {
      if (!tagLastSeen.has(tag)) tagLastSeen.set(tag, r.publishedAt);
    }
  }

  const filtered = opts.contentKind ? rows.filter((r) => r.contentKind === opts.contentKind) : rows;
  const scored = filtered.map((r) =>
    scorePost(r, when, { recentTags, recentKinds, negativeReasonFrequency, tagLastSeen }),
  );
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
