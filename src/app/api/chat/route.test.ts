import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory Prisma mock ──────────────────────────────────────────────────
const { mockPrisma } = vi.hoisted(() => {
  let _id = 0;
  const newId = () => `mock-${++_id}`;
  const decimal = (n: number) => ({ toNumber: () => n });
  const DECIMAL_FIELDS = new Set(["monthlyBudgetUsd", "cycleUsedUsd"]);

  type Row = Record<string, unknown>;
  const subscribers = new Map<string, Row>();

  function project(row: Row, select?: Row): Row {
    if (!select) {
      const r = { ...row };
      for (const f of DECIMAL_FIELDS) if (f in r) r[f] = decimal(r[f] as number);
      return r;
    }
    const r: Row = {};
    for (const [k, on] of Object.entries(select)) {
      if (on && k in row) r[k] = DECIMAL_FIELDS.has(k) ? decimal(row[k] as number) : row[k];
    }
    return r;
  }

  const subscriber = {
    async create({ data, select }: { data: Row; select?: Row }) {
      const now = new Date();
      const row: Row = {
        id: newId(),
        displayName: null,
        email: null,
        monthlyBudgetUsd: 1.2,
        cycleStart: now,
        cycleUsedUsd: 0,
        createdAt: now,
        lastSeenAt: null,
        revokedAt: null,
        commentsDisabledAt: null,
        codeBlindIndex: null,
        ...data,
      };
      subscribers.set(row.id as string, row);
      return project(row, select);
    },
    async findUnique({ where, select }: { where: Row; select?: Row }) {
      const row = subscribers.get(where.id as string);
      return row ? project(row, select) : null;
    },
    async findUniqueOrThrow({ where, select }: { where: Row; select?: Row }) {
      const row = subscribers.get(where.id as string);
      if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      return project(row, select);
    },
    async update({ where, data, select }: { where: Row; data: Row; select?: Row }) {
      const row = subscribers.get(where.id as string);
      if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      Object.assign(row, data);
      return project(row, select);
    },
    async delete({ where }: { where: Row }) {
      subscribers.delete(where.id as string);
    },
    _clear() {
      subscribers.clear();
    },
  };

  return { mockPrisma: { subscriber } };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// Mock NextAuth's auth() — must be hoisted before the route import
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/post-context-cache", () => ({
  getPostContext: vi
    .fn()
    .mockResolvedValue({ text: "ctx", count: 1, ids: new Set<string>() }),
}));

vi.mock("@/lib/chat/relevant-posts", () => ({
  getRelevantPosts: vi.fn().mockResolvedValue([]),
  formatRelevantPostsForPrompt: vi.fn().mockReturnValue(""),
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
    mockPrisma.subscriber._clear();
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
    const ownerId = process.env.OWNER_USER_ID ?? "owner-mock";
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
    // Subscriber's createdAt defaults to now() = FIXED_NOW (2026-04-28); cycle
    // anchors to the day-of-month → next reset is May 28, not the 1st.
    expect(body.cycleResetsAt).toMatch(/^2026-05-28T/);

    await prisma.subscriber.delete({ where: { id: created.id } });
  });

  it("returns 403 when subscriber is revoked", async () => {
    const ownerId = process.env.OWNER_USER_ID ?? "owner-mock";
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
