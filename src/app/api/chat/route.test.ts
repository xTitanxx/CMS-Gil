import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock NextAuth's auth() — must be hoisted before the route import
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/post-context-cache", () => ({
  getPostContext: vi.fn().mockResolvedValue({ text: "ctx", count: 1 }),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class {
      messages = {
        stream: vi.fn(),
      };
    },
  };
});

import { POST } from "./route";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const FIXED_NOW = new Date("2026-04-28T12:00:00Z");

describe("/api/chat budget enforcement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }) as never
    );
    expect(res.status).toBe(401);
  });

  it("returns 429 when subscriber is at budget cap", async () => {
    // Create a subscriber and push their cycleUsedUsd over budget directly via prisma
    const ownerId = process.env.OWNER_USER_ID!;
    const created = await prisma.subscriber.create({
      data: {
        name: "test-budget-capped",
        codeHash: "x",
        monthlyBudgetUsd: 0.01,
        cycleStart: FIXED_NOW,
        cycleUsedUsd: 0.50,
        createdById: ownerId,
      },
    });
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: created.id, role: "subscriber", subscriberId: created.id, name: "X" },
    });
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }) as never
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.cycleResetsAt).toMatch(/^2026-05-01T/);

    await prisma.subscriber.delete({ where: { id: created.id } });
  });

  it("returns 403 when subscriber is revoked", async () => {
    const ownerId = process.env.OWNER_USER_ID!;
    const created = await prisma.subscriber.create({
      data: {
        name: "test-revoked",
        codeHash: "x",
        revokedAt: FIXED_NOW,
        createdById: ownerId,
      },
    });
    (auth as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { id: created.id, role: "subscriber", subscriberId: created.id, name: "X" },
    });
    const res = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }) as never
    );
    expect(res.status).toBe(403);
    await prisma.subscriber.delete({ where: { id: created.id } });
  });
});
