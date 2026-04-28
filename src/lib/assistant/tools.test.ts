import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    post: { findFirst: vi.fn(), update: vi.fn() },
    publishRecord: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    postRating: { upsert: vi.fn() },
    userMemory: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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

  it("forwards from/to as a dateRange to retrieve", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool(
      "search_archive",
      { query: "hi", from: "2023-01-01", to: "2023-12-31" },
      { userId: "u1" },
    );
    const call = (retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.dateRange.from).toBeInstanceOf(Date);
    expect(call.dateRange.to).toBeInstanceOf(Date);
    expect(call.dateRange.from.getUTCFullYear()).toBe(2023);
    expect(call.dateRange.to.getUTCFullYear()).toBe(2023);
  });

  it("ignores invalid date strings", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool(
      "search_archive",
      { query: "hi", from: "not-a-date", to: "also-bad" },
      { userId: "u1" },
    );
    const call = (retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.dateRange).toBeUndefined();
  });

  it("accepts a single bound (only from)", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool(
      "search_archive",
      { query: "hi", from: "2024-06-01" },
      { userId: "u1" },
    );
    const call = (retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.dateRange.from).toBeInstanceOf(Date);
    expect(call.dateRange.to).toBeUndefined();
  });

  it("expands a date-only `to` to end-of-day so single-day queries match", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool(
      "search_archive",
      { query: "hi", from: "2023-10-15", to: "2023-10-15" },
      { userId: "u1" },
    );
    const call = (retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.dateRange.from.toISOString()).toBe("2023-10-15T00:00:00.000Z");
    expect(call.dateRange.to.toISOString()).toBe("2023-10-15T23:59:59.999Z");
  });

  it("respects an explicit ISO `to` time without expansion", async () => {
    (retrieve as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool(
      "search_archive",
      { query: "hi", to: "2023-10-15T12:00:00Z" },
      { userId: "u1" },
    );
    const call = (retrieve as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.dateRange.to.toISOString()).toBe("2023-10-15T12:00:00.000Z");
  });
});

describe("handleTool unknown tool", () => {
  it("returns error for unknown tool name", async () => {
    const out = await handleTool("wat", {}, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});

describe("handleTool update_post", () => {
  it("rejects unknown posts", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool("update_post", { postId: "x", patch: { body: "hi" } }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("updates body and tags", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool(
      "update_post",
      { postId: "p1", patch: { body: "new body", tags: ["a", "b"] } },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.body).toBe("new body");
    expect(call.data.tags).toEqual(["a", "b"]);
    expect(call.data.lifecycleOverridden).toBeUndefined();
  });

  it("sets lifecycleOverridden when lifecycle or season is patched", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool(
      "update_post",
      { postId: "p1", patch: { lifecycle: "EVERGREEN" } },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.lifecycle).toBe("EVERGREEN");
    expect(call.data.lifecycleOverridden).toBe(true);
  });

  it("rejects an empty patch", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool("update_post", { postId: "p1", patch: {} }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });
});

describe("handleTool rate_post", () => {
  it("rejects stars outside 1-5", async () => {
    const out = await handleTool("rate_post", { postId: "p1", stars: 7 }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("upserts rating with reasons", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.postRating.upsert as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "r1" });
    const out = await handleTool(
      "rate_post",
      { postId: "p1", stars: 5, reasons: ["timeless"], note: "great" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.postRating.upsert as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.postId).toBe("p1");
    expect(call.create.stars).toBe(5);
    expect(call.create.reasons).toEqual(["timeless"]);
    expect(call.create.note).toBe("great");
  });
});

describe("handleTool archive_post", () => {
  it("sets readiness=ARCHIVED and archivedAt", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    const out = await handleTool("archive_post", { postId: "p1" }, { userId: "u1" });
    expect(out.ok).toBe(true);
    const call = (prisma.post.update as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0].data.readiness === "ARCHIVED",
    );
    expect(call).toBeDefined();
    expect(call![0].data.archivedAt).toBeInstanceOf(Date);
  });
});

describe("handleTool save_memory", () => {
  it("rejects empty content", async () => {
    const out = await handleTool("save_memory", { content: "  " }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("rejects content over 500 chars", async () => {
    const out = await handleTool(
      "save_memory",
      { content: "x".repeat(501) },
      { userId: "u1" },
    );
    expect(out.ok).toBe(false);
  });

  it("saves with default kind=general when none provided", async () => {
    (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1",
      content: "likes short captions",
      kind: "general",
      postId: null,
    });
    const out = await handleTool(
      "save_memory",
      { content: "likes short captions" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.userId).toBe("u1");
    expect(call.data.kind).toBe("general");
    expect(call.data.postId).toBeNull();
  });

  it("falls back to 'general' for unknown kinds", async () => {
    (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1",
      content: "x",
      kind: "general",
      postId: null,
    });
    await handleTool("save_memory", { content: "x", kind: "weird" }, { userId: "u1" });
    const call = (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.kind).toBe("general");
  });

  it("rejects when postId points to another user's post", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool(
      "save_memory",
      { content: "loved it", kind: "post-feedback", postId: "p1" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(false);
    expect(out.ok === false && out.error).toContain("post not found");
  });

  it("ties memory to a valid post when postId is supplied", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1" });
    (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1",
      content: "loved it",
      kind: "post-feedback",
      postId: "p1",
    });
    const out = await handleTool(
      "save_memory",
      { content: "loved it", kind: "post-feedback", postId: "p1" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.userMemory.create as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.postId).toBe("p1");
    expect(call.data.kind).toBe("post-feedback");
  });
});

describe("handleTool list_memories", () => {
  it("scopes to the calling user", async () => {
    (prisma.userMemory.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await handleTool("list_memories", {}, { userId: "u1" });
    const call = (prisma.userMemory.findMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where.userId).toBe("u1");
  });
});

describe("handleTool delete_memory", () => {
  it("refuses to delete another user's memory", async () => {
    (prisma.userMemory.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool("delete_memory", { memoryId: "m1" }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("deletes when found", async () => {
    (prisma.userMemory.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m1" });
    (prisma.userMemory.delete as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m1" });
    const out = await handleTool("delete_memory", { memoryId: "m1" }, { userId: "u1" });
    expect(out.ok).toBe(true);
  });
});

describe("handleTool update_memory", () => {
  it("rejects empty content", async () => {
    const out = await handleTool("update_memory", { memoryId: "m1", content: "  " }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("refuses to edit another user's memory", async () => {
    (prisma.userMemory.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const out = await handleTool(
      "update_memory",
      { memoryId: "m1", content: "new" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(false);
  });

  it("updates when found", async () => {
    (prisma.userMemory.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "m1" });
    (prisma.userMemory.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "m1",
      content: "new",
    });
    const out = await handleTool(
      "update_memory",
      { memoryId: "m1", content: "new" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.userMemory.update as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.content).toBe("new");
  });
});

describe("handleTool publish_now", () => {
  it("rejects unknown platform", async () => {
    const out = await handleTool("publish_now", { postId: "p1", platform: "myspace" }, { userId: "u1" });
    expect(out.ok).toBe(false);
  });

  it("rejects non-READY posts", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "NOT_READY" });
    const out = await handleTool(
      "publish_now",
      { postId: "p1", platform: "instagram" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(false);
  });

  it("creates a PENDING PublishRecord with scheduledAt ≈ now", async () => {
    (prisma.post.findFirst as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "p1", readiness: "READY" });
    (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "pr1" });
    const out = await handleTool(
      "publish_now",
      { postId: "p1", platform: "instagram" },
      { userId: "u1" },
    );
    expect(out.ok).toBe(true);
    const call = (prisma.publishRecord.create as unknown as ReturnType<typeof vi.fn>).mock.calls.slice(-1)[0][0];
    expect(call.data.platform).toBe("INSTAGRAM");
    expect(call.data.status).toBe("PENDING");
    const scheduled = call.data.scheduledAt as Date;
    expect(Math.abs(scheduled.getTime() - Date.now())).toBeLessThan(5_000);
  });
});
