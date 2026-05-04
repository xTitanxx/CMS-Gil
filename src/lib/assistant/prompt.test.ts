import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { count: vi.fn(), findMany: vi.fn() },
    postRating: { count: vi.fn() },
    publishRecord: { count: vi.fn() },
    platformToken: { findMany: vi.fn() },
    account: { findFirst: vi.fn() },
    userMemory: { findMany: vi.fn() },
    userArchiveUnderstanding: { findUnique: vi.fn() },
  },
}));

import { buildSystemPrompt } from "./prompt";
import { prisma } from "@/lib/prisma";

beforeEach(() => {
  vi.clearAllMocks();
  (prisma.post.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(100);
  (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.postRating.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (prisma.publishRecord.count as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(0);
  (prisma.platformToken.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (prisma.account.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (prisma.userMemory.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe("buildSystemPrompt — archive understanding", () => {
  it("omits the understanding block when no row exists", async () => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's writing — internalized");
    expect(out).not.toContain("VOICE:");
  });

  it("includes voice profile and thematic map when row exists", async () => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProfile: "He writes with quiet, observant prose...",
      thematicMap: "He writes often about family and the seasons...",
      basedOnPostCount: 1235,
      generatedAt: new Date("2026-05-01T00:00:00Z"),
    });

    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));

    expect(out).toContain("Gil's writing — internalized (distilled from 1235 posts on 2026-05-01)");
    expect(out).toContain("He writes with quiet, observant prose");
    expect(out).toContain("He writes often about family and the seasons");
  });

  it("omits the block when row exists but voice and thematic map are empty", async () => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProfile: "",
      thematicMap: "",
      basedOnPostCount: 0,
      generatedAt: new Date(),
    });
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's writing — internalized");
  });
});

describe("buildSystemPrompt — full archive index", () => {
  beforeEach(() => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("omits the archive block when there are no usable posts", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's full archive");
  });

  it("renders all posts inline newest-first with id/date/kind/tags headers", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        originalDate: new Date("2024-08-01T12:00:00Z"),
        postType: "POST",
        tags: ["garden", "spring", "morning"],
        body: "An afternoon in the garden, the light slanting low across the lavender bed.",
      },
      {
        id: "p2",
        originalDate: new Date("2023-11-20T12:00:00Z"),
        postType: "REEL",
        tags: ["family"],
        body: "My father called this morning. He sounded tired but kind.",
      },
    ]);

    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));

    expect(out).toContain("Gil's full archive — every post, newest first (2 posts");
    expect(out).toContain("[post:p1 | 2024-08-01 | POST | garden, spring, morning]");
    expect(out).toContain("An afternoon in the garden");
    expect(out).toContain("[post:p2 | 2023-11-20 | REEL | family]");
    expect(out).toContain("My father called this morning");
    expect(out).toContain("How to use this archive:");
  });

  it("excludes posts with bodies under the 30-char minimum", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "long", originalDate: new Date("2024-01-01T00:00:00Z"), kind: "POST", tags: [], body: "a".repeat(60) },
      { id: "short", originalDate: new Date("2024-02-01T00:00:00Z"), kind: "POST", tags: [], body: "too short" },
    ]);
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).toContain("[post:long");
    expect(out).not.toContain("[post:short");
    expect(out).toContain("(1 posts");
  });

  it("truncates long bodies and notes the truncation count in the header", async () => {
    const longBody = "word ".repeat(300).trim();
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "p1", originalDate: new Date("2024-01-01T00:00:00Z"), kind: "POST", tags: [], body: longBody },
      { id: "p2", originalDate: new Date("2024-02-01T00:00:00Z"), kind: "POST", tags: [], body: "short body that fits in full no problem here." },
    ]);
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).toContain("…");
    expect(out).toContain("1 long posts are capped at 800 chars");
  });
});
