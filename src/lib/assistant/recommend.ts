import type {
  CandidateRow,
  DailyMix,
  DailyMixOptions,
  Recommendation,
  RecommendOptions,
} from "./types";
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
  // Audience-side signal from PostAnalytics. Lower than `rating` so Gil's own
  // taste outranks raw popularity, but high enough to reorder ties.
  engagement: 0.5,
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

  // Engagement: audience-side signal from scraped/fetched PostAnalytics.
  // Normalized engagement is in [0, 1] relative to the user's own p90 (so a
  // post matching their typical "good" engagement scores ~1.0). Posts with
  // no analytics row are treated as 0 — neutral, neither rewarded nor
  // punished. Below the user's median we also subtract a small penalty so a
  // measured-flop doesn't tie a measured-hit.
  let engagementRaw = 0;
  if (post.engagementNormalized != null) {
    engagementRaw =
      post.engagementNormalized < 0.2
        ? -0.3
        : post.engagementNormalized;
  }
  const engagement = engagementRaw * WEIGHTS.engagement;

  // Negative-reason penalty: 0.15 per reason that appears on ≥3 peers
  const penaltyReasons = post.ratingReasons.reduce(
    (s, r) => ((ctx.negativeReasonFrequency.get(r) ?? 0) >= 3 ? s + 0.15 : s),
    0,
  );

  const total =
    ratingScore +
    lifecycleFit +
    freshness +
    topicRecency +
    tagVariety +
    kindDiversity +
    engagement -
    penaltyReasons;

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
  if (post.engagementNormalized != null && post.engagementNormalized >= 0.85)
    reasons.push("popular");
  else if (post.engagementNormalized != null && post.engagementNormalized < 0.2)
    reasons.push("flopped previously");

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
      engagement,
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

interface LoadCandidatesOptions {
  userId: string;
  when: Date;
  kind?: RecommendOptions["kind"];
  excludePostIds?: string[];
}

interface LoadedCandidates {
  scored: Recommendation[];
  rows: CandidateRow[];
}

/** Compute the user's p90 engagement total across all their analyzed posts. */
function computeP90(perPostTotals: number[]): number | null {
  if (perPostTotals.length === 0) return null;
  const sorted = [...perPostTotals].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * 0.9),
  );
  const p90 = sorted[idx];
  return p90 > 0 ? p90 : null;
}

/**
 * Single shared candidate-loading pass — used by both `recommend` (single
 * contentKind) and `recommendMix` (balanced multi-bucket). Returns scored
 * candidates without any contentKind filtering or limit slicing applied.
 */
async function loadAndScoreCandidates(
  opts: LoadCandidatesOptions,
): Promise<LoadedCandidates> {
  const when = opts.when;
  const cutoff = subDays(when, RECENCY_DAYS);
  const topicCutoff = subDays(when, TOPIC_RECENCY_LOOKBACK_DAYS);

  const [posts, recentPublishes, negativeReasonRows, topicHistory, allAnalytics] = await Promise.all([
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
          select: { storageKey: true, mimeType: true, hasAudio: true },
        },
        analytics: {
          select: { reactions: true, comments: true, shares: true },
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
    // Population baseline for engagement normalization — every analytics row
    // the user has, so we can compute their personal p90.
    prisma.postAnalytics.findMany({
      where: { post: { userId: opts.userId } },
      select: {
        postId: true,
        reactions: true,
        comments: true,
        shares: true,
      },
    }),
  ]);

  // Per-post engagement totals across all platforms, for the user's whole
  // history. Used as the baseline for normalizing each candidate's engagement.
  const perPostTotals = new Map<string, number>();
  for (const a of allAnalytics) {
    const total = (a.reactions ?? 0) + (a.comments ?? 0) + (a.shares ?? 0);
    perPostTotals.set(a.postId, (perPostTotals.get(a.postId) ?? 0) + total);
  }
  const p90 = computeP90(Array.from(perPostTotals.values()));

  // Drop posts whose video media is silent — readiness considers them
  // unfinished, and proposing them sets the user up to ship a muted reel.
  const audibleOnly = posts.filter((p) => {
    const videos = p.media.filter((m) => m.mimeType.startsWith("video/"));
    if (videos.length === 0) return true;
    return videos.every((m) => m.hasAudio !== false);
  });

  const rows: CandidateRow[] = audibleOnly.map((p) => {
    const mimes = p.media.map((m) => m.mimeType);
    const thumbSource = p.media.find((m) => m.mimeType.startsWith("image/")) ?? p.media[0];

    const analyticsRows = p.analytics ?? [];
    const engagementTotal = analyticsRows.length
      ? analyticsRows.reduce(
          (s, a) =>
            s +
            (a.reactions ?? 0) +
            (a.comments ?? 0) +
            (a.shares ?? 0),
          0,
        )
      : null;
    const engagementNormalized =
      engagementTotal != null && p90 != null
        ? Math.min(1, engagementTotal / p90)
        : null;

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
      engagementTotal,
      engagementNormalized,
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

  const scored = rows.map((r) =>
    scorePost(r, when, { recentTags, recentKinds, negativeReasonFrequency, tagLastSeen }),
  );
  scored.sort((a, b) => b.score - a.score);
  return { scored, rows };
}

export async function recommend(opts: RecommendOptions): Promise<Recommendation[]> {
  const when = opts.when ?? new Date();
  const limit = opts.limit ?? 10;
  const { scored } = await loadAndScoreCandidates({
    userId: opts.userId,
    when,
    kind: opts.kind,
    excludePostIds: opts.excludePostIds,
  });
  const filtered = opts.contentKind ? scored.filter((r) => r.contentKind === opts.contentKind) : scored;
  return filtered.slice(0, limit);
}

/**
 * Picks `limit` recommendations from a candidate pool, penalizing tag overlap
 * with already-picked posts. This is the cross-bucket diversification step
 * for recommendMix — each pick re-weights the remainder so we don't end up
 * with two reels and an image all about the same topic.
 *
 * The penalty is `WEIGHTS.variety * jaccard(candidate, alreadyPicked)`, so
 * full overlap can wipe out the entire variety-bonus a candidate already
 * earned during initial scoring. Already-picked posts in `seenIds` are
 * skipped entirely.
 */
function diversifyMMR(
  pool: Recommendation[],
  limit: number,
  seenIds: Set<string>,
  pickedTags: string[][],
): Recommendation[] {
  const picked: Recommendation[] = [];
  const available = pool.filter((r) => !seenIds.has(r.postId));
  const localPickedTags = [...pickedTags];

  while (picked.length < limit && available.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < available.length; i++) {
      const cand = available[i];
      let penalty = 0;
      for (const t of localPickedTags) {
        penalty += jaccard(cand.tags, t);
      }
      const adjusted = cand.score - penalty * WEIGHTS.variety;
      if (adjusted > bestScore) {
        bestScore = adjusted;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;
    const [winner] = available.splice(bestIdx, 1);
    picked.push(winner);
    localPickedTags.push(winner.tags);
    seenIds.add(winner.postId);
  }
  return picked;
}

/**
 * Returns a balanced daily mix of recommendations (default 2 video + 2 image
 * + 2 short-text + 0 long-text). One DB pass; cross-bucket diversification
 * so the picks don't share a dominant tag across kinds.
 */
export async function recommendMix(opts: DailyMixOptions): Promise<DailyMix> {
  const when = opts.when ?? new Date();
  const videoLimit = opts.videoLimit ?? 2;
  const imageLimit = opts.imageLimit ?? 2;
  const shortTextLimit = opts.shortTextLimit ?? 2;
  const longTextLimit = opts.longTextLimit ?? 0;

  const { scored } = await loadAndScoreCandidates({
    userId: opts.userId,
    when,
    excludePostIds: opts.excludePostIds,
  });

  const seenIds = new Set<string>();
  const pickedTags: string[][] = [];

  const video = diversifyMMR(
    scored.filter((r) => r.contentKind === "video"),
    videoLimit,
    seenIds,
    pickedTags,
  );
  pickedTags.push(...video.map((r) => r.tags));

  const image = diversifyMMR(
    scored.filter((r) => r.contentKind === "image"),
    imageLimit,
    seenIds,
    pickedTags,
  );
  pickedTags.push(...image.map((r) => r.tags));

  const shortText = diversifyMMR(
    scored.filter((r) => r.contentKind === "short-text"),
    shortTextLimit,
    seenIds,
    pickedTags,
  );
  pickedTags.push(...shortText.map((r) => r.tags));

  const longText =
    longTextLimit > 0
      ? diversifyMMR(
          scored.filter((r) => r.contentKind === "long-text"),
          longTextLimit,
          seenIds,
          pickedTags,
        )
      : [];

  return { video, image, shortText, longText };
}
