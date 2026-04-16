import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: vi.fn() },
    publishRecord: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("./recommend", () => ({ recommend: vi.fn() }));
vi.mock("./retrieve", () => ({ retrieve: vi.fn() }));

import { handleTool } from "./tools";
import { prisma } from "@/lib/prisma";
import { recommend } from "./recommend";
import { retrieve } from "./retrieve";

beforeEach(() => { vi.clearAllMocks(); });

describe("handleTool schedule_post", () => {
  it("rejects non-READY posts", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "NOT_READY" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("READY");
  });

  it("rejects if another pending exists within 24h", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "pr1" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("already scheduled");
  });

  it("creates PublishRecord on happy path", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "pr2" });
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "instagram", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(true);
    const call = (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.postId).toBe("p1");
    expect(call.data.platform).toBe("INSTAGRAM"); // enum-mapped
  });

  it("rejects unknown platform slug", async () => {
    const out = await handleTool("schedule_post", {
      postId: "p1", platform: "myspace", scheduledAt: "2026-05-01T12:00:00Z",
    }, { userId: "u1" });
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("platform");
  });
});

describe("handleTool unschedule", () => {
  it("refuses to delete another user's record", async () => {
    (prisma.publishRecord.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool("unschedule", { recordId: "pr1" }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});

describe("handleTool recommend_posts / search_archive", () => {
  it("calls recommend with userId", async () => {
    (recommend as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool("recommend_posts", { limit: 3 }, { userId: "u1" });
    expect((recommend as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].userId).toBe("u1");
  });

  it("calls retrieve with userId", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool("search_archive", { query: "hi" }, { userId: "u1" });
    expect((retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].userId).toBe("u1");
  });
});

describe("handleTool unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const out = await handleTool("wat", {}, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});
