import { describe, it, expect } from "vitest";
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
    });
    expect(r.breakdown.ratingScore).toBe(1.0 * WEIGHTS.rating);
  });

  it("penalizes 1★ posts", () => {
    const r = scorePost(row({ stars: 1 }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.ratingScore).toBe(-0.4 * WEIGHTS.rating);
  });

  it("treats unrated posts as small positive prior", () => {
    const r = scorePost(row({ stars: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.ratingScore).toBeCloseTo(0.15 * WEIGHTS.rating);
  });

  it("rewards evergreen", () => {
    const r = scorePost(row({ lifecycle: "EVERGREEN" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("penalizes seasonal off-season", () => {
    // April 16 is SPRING; seasonal FALL is the opposite season → -1
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "FALL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-1.0 * WEIGHTS.fitness);
  });

  it("rewards seasonal in-season", () => {
    const r = scorePost(row({ lifecycle: "SEASONAL", season: "SPRING" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(1.0 * WEIGHTS.fitness);
  });

  it("strongly penalizes ephemeral", () => {
    const r = scorePost(row({ lifecycle: "EPHEMERAL" }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.lifecycleFit).toBe(-0.8 * WEIGHTS.fitness);
  });

  it("scales freshness with months since last publish", () => {
    // ~24 months ago → 1 - e^(-1) ≈ 0.632
    const r = scorePost(
      row({ lastPublishedAt: new Date("2024-04-16") }),
      now,
      { recentTags: [], recentKinds: [], negativeReasonFrequency: new Map() },
    );
    expect(r.breakdown.freshness).toBeCloseTo(0.632 * WEIGHTS.freshness, 2);
  });

  it("gives never-published full freshness", () => {
    const r = scorePost(row({ lastPublishedAt: null }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.freshness).toBe(1.0 * WEIGHTS.freshness);
  });

  it("penalizes tag overlap with recent publishes", () => {
    const r = scorePost(row({ tags: ["breath", "mornings"] }), now, {
      recentTags: [["breath", "mornings"]], // jaccard = 1
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.tagVariety).toBe(0);
  });

  it("rewards tag variety when no overlap with recent publishes", () => {
    const r = scorePost(row({ tags: ["breath"] }), now, {
      recentTags: [["cooking", "outdoor"]], // jaccard = 0
      recentKinds: [],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.tagVariety).toBeCloseTo(WEIGHTS.variety);
  });

  it("penalizes kind repetition when last 3 publishes share kind", () => {
    const r = scorePost(row({ postType: "POST" }), now, {
      recentTags: [],
      recentKinds: ["POST", "POST", "POST"],
      negativeReasonFrequency: new Map(),
    });
    expect(r.breakdown.kindDiversity).toBe(-1 * WEIGHTS.diversity);
  });

  it("applies negative-reason penalty when rating reasons recur across peers", () => {
    const freq = new Map<string, number>([["too-personal", 3]]);
    const r = scorePost(row({ ratingReasons: ["too-personal"] }), now, {
      recentTags: [],
      recentKinds: [],
      negativeReasonFrequency: freq,
    });
    expect(r.breakdown.penaltyReasons).toBe(0.15);
  });
});

import { vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findMany: vi.fn() },
    publishRecord: { findMany: vi.fn() },
    postRating: { groupBy: vi.fn() },
  },
}));

import { recommend } from "./recommend";
import { prisma } from "@/lib/prisma";

describe("recommend", () => {
  it("ranks READY posts and excludes given ids", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        body: "x",
        tags: ["a"],
        originalDate: new Date("2024-01-01"),
        lifecycle: "EVERGREEN",
        season: null,
        postType: "POST",
        publishCount: 0,
        rating: { stars: 5, reasons: [] },
        publishes: [],
      },
      {
        id: "p2",
        body: "y",
        tags: ["a"],
        originalDate: new Date("2024-01-01"),
        lifecycle: "EPHEMERAL",
        season: null,
        postType: "POST",
        publishCount: 0,
        rating: null,
        publishes: [],
      },
    ]);
    (prisma.publishRecord.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (prisma.postRating.groupBy as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const recs = await recommend({
      userId: "u1",
      when: new Date("2026-04-16"),
      excludePostIds: [],
      limit: 5,
    });

    expect(recs.map((r) => r.postId)).toEqual(["p1", "p2"]);
    expect(recs[0].score).toBeGreaterThan(recs[1].score);
  });
});
