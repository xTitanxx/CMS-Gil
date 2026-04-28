import { describe, it, expect, vi } from "vitest";
import { scorePost, WEIGHTS } from "./recommend";
import type { CandidateRow } from "./types";

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "p1",
    body: "hello",
    tags: ["breath"],
    originalDate: new Date("2024-01-01"),
    lifecycle: "EVERGREEN",
    season: null,
    postType: "POST",
    publishCount: 0,
    stars: null,
    ratingReasons: [],
    lastPublishedAt: null,
    thumbUrl: null,
    contentKind: "short-text",
    platformUrl: null,
    engagementTotal: null,
    engagementNormalized: null,
    ...overrides,
  };
}

describe("scorePost", () => {
  const now = new Date("2026-04-16");

  it("gives 5★ posts a large rating boost", () => {
    const r = scorePost(row({ stars: 5 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.ratingScore).toBe(1.0 * WEIGHTS.rating);
  });

  it("penalizes 1★ posts", () => {
    const r = scorePost(row({ stars: 1 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.ratingScore).toBe(-0.4 * WEIGHTS.rating);
  });

  it("treats unrated posts as small negative prior (prefer rated content)", () => {
    const r = scorePost(row({ stars: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.ratingScore).toBeCloseTo(-0.15 * WEIGHTS.rating);
  });

  it("rewards evergreen", () => {
    const r = scorePost(row({ lifecycle: "EVERGREEN" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("penalizes seasonal off-season", () => {
    // April 16 is SPRING; seasonal FALL is the opposite season → -1
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "FALL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-1.0 * WEIGHTS.fitness);
  });

  it("rewards seasonal in-season", () => {
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "SPRING" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("strongly penalizes ephemeral", () => {
    const r = scorePost(row({ lifecycle: "EPHEMERAL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-0.8 * WEIGHTS.fitness);
  });

  it("scales freshness with months since last publish", () => {
    // ~24 months ago → 1 - e^(-1) ≈ 0.632
    const r = scorePost(
      row({ lastPublishedAt: new Date("2024-04-16") }),
      now,
      { recentTags: [], recentKinds: [], negativeReasonFrequency: new Map(), tagLastSeen: new Map() },
    );
    expect(r.breakdown.freshness).toBeCloseTo(0.632 * WEIGHTS.freshness, 2);
  });

  it("gives never-published a moderate freshness score", () => {
    const r = scorePost(row({ lastPublishedAt: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.freshness).toBeCloseTo(0.6 * WEIGHTS.freshness);
  });

  it("penalizes tag overlap with recent publishes", () => {
    const r = scorePost(row({ tags: ["breath", "mornings"] }), now, {
      recentTags: [["breath", "mornings"]], // jaccard = 1
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.tagVariety).toBe(0);
  });

  it("rewards tag variety when no overlap with recent publishes", () => {
    const r = scorePost(row({ tags: ["breath"] }), now, {
      recentTags: [["cooking", "outdoor"]], // jaccard = 0
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.tagVariety).toBeCloseTo(WEIGHTS.variety);
  });

  it("penalizes kind repetition when last 3 publishes share kind", () => {
    const r = scorePost(row({ postType: "POST" }), now, {
      recentTags: [],
      recentKinds: ["POST", "POST", "POST"],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.kindDiversity).toBe(-1 * WEIGHTS.diversity);
  });

  it("applies negative-reason penalty when rating reasons recur across peers", () => {
    const freq = new Map<string, number>([["too-personal", 3]]);
    const r = scorePost(row({ ratingReasons: ["too-personal"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: freq,
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.penaltyReasons).toBe(0.15);
  });

  it("boosts posts whose tags haven't been published recently (stale-topic)", () => {
    // Tag "breath" was last published a year ago → effectively max staleness.
    const lastSeen = new Map<string, Date>([
      ["breath", new Date("2025-04-16")],
    ]);
    const r = scorePost(row({ tags: ["breath"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: lastSeen,
    });
    expect(r.breakdown.topicRecency).toBeCloseTo(WEIGHTS.topicRecency, 1);
  });

  it("gives near-zero topic recency when the topic was just published", () => {
    const lastSeen = new Map<string, Date>([
      ["breath", new Date("2026-04-15")], // 1 day before "now"
    ]);
    const r = scorePost(row({ tags: ["breath"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: lastSeen,
    });
    // 1 - exp(-1/30) ≈ 0.033
    expect(r.breakdown.topicRecency).toBeCloseTo(0.033 * WEIGHTS.topicRecency, 2);
  });

  it("uses the *most stale* tag when a post has multiple tags", () => {
    const lastSeen = new Map<string, Date>([
      ["breath", new Date("2026-04-15")], // 1 day ago — fresh
      ["travel", new Date("2025-04-16")], // 365 days ago — stale
    ]);
    const r = scorePost(row({ tags: ["breath", "travel"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: lastSeen,
    });
    expect(r.breakdown.topicRecency).toBeCloseTo(WEIGHTS.topicRecency, 1);
  });

  it("treats never-seen tags as full staleness", () => {
    const r = scorePost(row({ tags: ["uncovered-topic"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.topicRecency).toBe(1.0 * WEIGHTS.topicRecency);
  });

  it("rewards posts with high normalized engagement", () => {
    const r = scorePost(row({ engagementTotal: 500, engagementNormalized: 1 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.engagement).toBeCloseTo(WEIGHTS.engagement);
    expect(r.reasons).toContain("popular");
  });

  it("penalizes posts with very low engagement (below 0.2 of p90)", () => {
    const r = scorePost(row({ engagementTotal: 1, engagementNormalized: 0.05 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.engagement).toBeLessThan(0);
    expect(r.reasons).toContain("flopped previously");
  });

  it("treats no-analytics posts as neutral on engagement", () => {
    const r = scorePost(row({ engagementTotal: null, engagementNormalized: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
      tagLastSeen: new Map(),
    });
    expect(r.breakdown.engagement).toBe(0);
    expect(r.reasons).not.toContain("popular");
    expect(r.reasons).not.toContain("flopped previously");
  });
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: vi.fn() },
    publishRecord: { findMany: vi.fn() },
    postAnalytics: { findMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    postRating: { groupBy: vi.fn() }, // kept for backward compat; unused now
  },
}));

import { recommend, recommendMix } from "./recommend";
import { prisma } from "@/lib/prisma";

function postFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    body: "x",
    tags: ["a"],
    originalDate: new Date("2024-01-01"),
    lifecycle: "EVERGREEN",
    season: null,
    postType: "POST",
    publishCount: 0,
    platformUrl: null,
    rating: { stars: 5, reasons: [] },
    publishes: [],
    media: [],
    analytics: [],
    ...overrides,
  };
}

describe("recommend", () => {
  it("ranks READY posts and excludes given ids", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      postFixture({ id: "p1", rating: { stars: 5, reasons: [] } }),
      postFixture({ id: "p2", lifecycle: "EPHEMERAL", rating: null }),
    ]);
    (prisma.publishRecord.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.postAnalytics.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const recs = await recommend({
      userId: "u1",
      when: new Date("2026-04-16"),
      excludePostIds: [],
      limit: 5,
    });

    expect(recs.map((r) => r.postId)).toEqual(["p1", "p2"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
  });

  it("normalizes engagement against the user's own p90", async () => {
    // Population baseline: 10 posts at engagement 1, one outlier at 1000.
    // p90 of [1×10,1000] sorted = position 9 of 11 (90th pct) → 1.
    // Candidate engagement of 1 → normalized 1.0; 1000 → clamped to 1.0.
    const populationAnalytics = Array.from({ length: 10 }, (_, i) => ({
      postId: `hist-${i}`,
      reactions: 1,
      comments: 0,
      shares: 0,
    }));
    populationAnalytics.push({ postId: "hist-outlier", reactions: 1000, comments: 0, shares: 0 });

    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      postFixture({
        id: "popular",
        analytics: [{ reactions: 50, comments: 30, shares: 20 }],
      }),
      postFixture({
        id: "no-analytics",
        analytics: [],
      }),
    ]);
    (prisma.publishRecord.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.postAnalytics.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(populationAnalytics);

    const recs = await recommend({
      userId: "u1",
      when: new Date("2026-04-16"),
      limit: 5,
    });

    const popular = recs.find((r) => r.postId === "popular")!;
    const noAnalytics = recs.find((r) => r.postId === "no-analytics")!;
    expect(popular.breakdown.engagement).toBeGreaterThan(0);
    expect(noAnalytics.breakdown.engagement).toBe(0);
    expect(popular.score).toBeGreaterThan(noAnalytics.score);
  });
});

describe("recommendMix", () => {
  it("returns a balanced mix across content kinds without duplicates", async () => {
    // Three of each kind so we can confirm the mix picks 2 of each.
    const fixtures = [
      // videos: REELs (postType=REEL gets contentKind=video automatically)
      postFixture({ id: "v1", postType: "REEL", media: [{ storageKey: "k1", mimeType: "video/mp4", hasAudio: true }] }),
      postFixture({ id: "v2", postType: "REEL", media: [{ storageKey: "k2", mimeType: "video/mp4", hasAudio: true }] }),
      postFixture({ id: "v3", postType: "REEL", media: [{ storageKey: "k3", mimeType: "video/mp4", hasAudio: true }] }),
      // images
      postFixture({ id: "i1", media: [{ storageKey: "k4", mimeType: "image/jpeg", hasAudio: null }] }),
      postFixture({ id: "i2", media: [{ storageKey: "k5", mimeType: "image/jpeg", hasAudio: null }] }),
      postFixture({ id: "i3", media: [{ storageKey: "k6", mimeType: "image/jpeg", hasAudio: null }] }),
      // short-text (no media, body ≤ 400 chars)
      postFixture({ id: "s1", body: "short one" }),
      postFixture({ id: "s2", body: "short two" }),
      postFixture({ id: "s3", body: "short three" }),
    ];
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fixtures);
    (prisma.publishRecord.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.postAnalytics.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const mix = await recommendMix({
      userId: "u1",
      when: new Date("2026-04-16"),
    });

    expect(mix.video.length).toBe(2);
    expect(mix.image.length).toBe(2);
    expect(mix.shortText.length).toBe(2);
    expect(mix.longText.length).toBe(0);

    // No duplicate post ids across buckets.
    const all = [...mix.video, ...mix.image, ...mix.shortText].map((r) => r.postId);
    expect(new Set(all).size).toBe(all.length);
  });

  it("respects custom per-bucket limits and includes long-text when requested", async () => {
    const fixtures = [
      postFixture({ id: "L1", body: "x".repeat(500) }), // long-text
      postFixture({ id: "L2", body: "y".repeat(500) }),
      postFixture({ id: "i1", media: [{ storageKey: "k1", mimeType: "image/jpeg", hasAudio: null }] }),
    ];
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(fixtures);
    (prisma.publishRecord.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.postAnalytics.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const mix = await recommendMix({
      userId: "u1",
      when: new Date("2026-04-16"),
      videoLimit: 0,
      imageLimit: 1,
      shortTextLimit: 0,
      longTextLimit: 1,
    });

    expect(mix.video).toEqual([]);
    expect(mix.image.length).toBe(1);
    expect(mix.shortText).toEqual([]);
    expect(mix.longText.length).toBe(1);
  });
});
