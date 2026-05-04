import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { count: vi.fn() },
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
    expect(out).not.toContain("REPRESENTATIVE POSTS");
  });

  it("includes voice profile, thematic map, and sample bodies when row exists", async () => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProfile: "He writes with quiet, observant prose...",
      thematicMap: "He writes often about family and the seasons...",
      sampleBodies: [
        {
          id: "post-abc",
          originalDate: "2024-03-15",
          body: "An afternoon in the garden — the light slanting low...",
          tags: ["garden", "spring"],
          theme: "garden",
        },
        {
          id: "post-xyz",
          originalDate: "2023-11-20",
          body: "My father called this morning...",
          tags: ["dad", "family"],
          theme: "family",
        },
      ],
      basedOnPostCount: 1235,
      generatedAt: new Date("2026-05-01T00:00:00Z"),
    });

    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));

    expect(out).toContain("Gil's writing — internalized (distilled from 1235 posts on 2026-05-01)");
    expect(out).toContain("He writes with quiet, observant prose");
    expect(out).toContain("He writes often about family and the seasons");
    expect(out).toContain("[post:post-abc | 2024-03-15 | theme: garden | tags: garden, spring]");
    expect(out).toContain("An afternoon in the garden");
    expect(out).toContain("[post:post-xyz | 2023-11-20 | theme: family | tags: dad, family]");
    expect(out).toContain("My father called this morning");
  });

  it("omits the block when row exists but all fields are empty (no usable archive)", async () => {
    (prisma.userArchiveUnderstanding.findUnique as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      voiceProfile: "",
      thematicMap: "",
      sampleBodies: [],
      basedOnPostCount: 0,
      generatedAt: new Date(),
    });
    const out = await buildSystemPrompt("u1", new Date("2026-05-04T12:00:00Z"));
    expect(out).not.toContain("Gil's writing — internalized");
  });
});
