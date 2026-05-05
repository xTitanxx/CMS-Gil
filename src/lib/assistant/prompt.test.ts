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

// The prompt builder returns { cached, dynamic } so the static prefix can be
// cached while the volatile context block (date, counts, memories) is sent
// uncached. Tests treat the prompt as one logical document.
async function buildPromptText(userId: string, now: Date): Promise<string> {
  const out = await buildSystemPrompt(userId, now);
  return `${out.cached}\n${out.dynamic}`;
}

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
    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));
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

    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));

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
    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's writing — internalized");
  });
});

describe("buildSystemPrompt — slim archive guidance", () => {
  beforeEach(() => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  it("does NOT inline the full archive — the assistant must use tools", async () => {
    (prisma.post.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "p1",
        originalDate: new Date("2024-08-01T12:00:00Z"),
        postType: "POST",
        tags: ["garden"],
        body: "An afternoon in the garden, the light slanting low across the lavender bed.",
      },
    ]);
    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's full archive");
    expect(out).not.toContain("[post:p1 |");
    expect(out).not.toContain("An afternoon in the garden");
  });

  it("instructs the assistant to use search_archive / get_post for archive lookups", async () => {
    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).toContain("Working with the archive");
    expect(out).toContain("search_archive");
    expect(out).toContain("get_post");
  });

  it("tells the assistant to pass excludePostIds for fresh recommendations", async () => {
    const out = await buildPromptText("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).toContain("excludePostIds");
  });
});
