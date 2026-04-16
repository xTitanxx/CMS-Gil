import type { CandidateRow, Recommendation } from "./types";
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
    const months =
      (when.getTime() - post.lastPublishedAt.getTime()) /
      (1000 * 60 * 60 * 24 * 30);
    freshnessRaw = 1 - Math.exp(-months / 24);
  }
  const freshness = freshnessRaw * WEIGHTS.freshness;

  // Tag variety (0 = full overlap → penalty; WEIGHTS.variety = zero overlap → reward)
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
  if (last3SameKind) reasons.push("breaks kind streak");

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
  };
}
