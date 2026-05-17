import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";

// ── In-memory Prisma simulator ─────────────────────────────────────────────
const { mockPrisma } = vi.hoisted(() => {
  // Provide a valid pepper so blindIndex() doesn't throw in test environments
  // that have no .env.local. Value doesn't need to be secret — just 32 bytes.
  process.env.SUBSCRIBER_INDEX_PEPPER ??= "00".repeat(32);

  let _id = 0;
  const newId = () => `mock-${++_id}`;
  const decimal = (n: number) => ({ toNumber: () => n });
  const DECIMAL_FIELDS = new Set(["monthlyBudgetUsd", "cycleUsedUsd"]);

  type Row = Record<string, unknown>;
  const subscribers = new Map<string, Row>();
  const users = new Map<string, Row>();

  function matches(row: Row, where: Row): boolean {
    for (const [k, cond] of Object.entries(where)) {
      const v = row[k];
      if (cond === null) {
        if (v !== null && v !== undefined) return false;
      } else if (cond && typeof cond === "object") {
        const c = cond as Row;
        if ("startsWith" in c && (typeof v !== "string" || !v.startsWith(c.startsWith as string)))
          return false;
        if ("not" in c && v === c.not) return false;
      } else if (v !== cond) {
        return false;
      }
    }
    return true;
  }

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

  function withDefaults(data: Row): Row {
    const now = new Date();
    return {
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
  }

  const subscriber = {
    async findFirst({ where, select }: { where?: Row; select?: Row } = {}) {
      for (const row of subscribers.values()) {
        if (!where || matches(row, where)) return project(row, select);
      }
      return null;
    },
    async findUnique({ where, select }: { where: Row; select?: Row }) {
      for (const row of subscribers.values()) {
        if (matches(row, where)) return project(row, select);
      }
      return null;
    },
    async findUniqueOrThrow({ where, select }: { where: Row; select?: Row }) {
      for (const row of subscribers.values()) {
        if (matches(row, where)) return project(row, select);
      }
      throw Object.assign(new Error("Record not found"), { code: "P2025" });
    },
    async findMany({ where, select, orderBy }: { where?: Row; select?: Row; orderBy?: Row } = {}) {
      let rows = [...subscribers.values()].filter((r) => !where || matches(r, where));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0] ?? [];
        if (field)
          rows.sort((a, b) => {
            const av = a[field] as string | number | Date;
            const bv = b[field] as string | number | Date;
            return (av < bv ? -1 : av > bv ? 1 : 0) * (dir === "desc" ? -1 : 1);
          });
      }
      return rows.map((r) => project(r, select));
    },
    async create({ data, select }: { data: Row; select?: Row }) {
      const row = withDefaults(data);
      subscribers.set(row.id as string, row);
      return project(row, select);
    },
    async update({ where, data, select }: { where: Row; data: Row; select?: Row }) {
      for (const row of subscribers.values()) {
        if (matches(row, where)) {
          Object.assign(row, data);
          return project(row, select);
        }
      }
      throw Object.assign(new Error("Record not found for update"), { code: "P2025" });
    },
    async delete({ where }: { where: Row }) {
      for (const [id, row] of subscribers.entries()) {
        if (matches(row, where)) {
          subscribers.delete(id);
          return row;
        }
      }
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      let count = 0;
      for (const [id, row] of subscribers.entries()) {
        if (!where || matches(row, where)) {
          subscribers.delete(id);
          count++;
        }
      }
      return { count };
    },
  };

  const user = {
    async findUnique({ where }: { where: Row }) {
      return users.get(where.id as string) ?? null;
    },
    async create({ data }: { data: Row }) {
      const row = { id: newId(), ...data };
      users.set(row.id as string, row);
      return row;
    },
  };

  return { mockPrisma: { subscriber, user } };
});

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

// eslint-disable-next-line import/order
import { prisma } from "@/lib/prisma";
import {
  createSubscriber,
  listSubscribers,
  updateSubscriber,
  regenerateCode,
  deleteSubscriber,
  findSubscriberByCode,
} from "./service";

let adminId: string;

beforeAll(async () => {
  const ownerId = process.env.OWNER_USER_ID;
  if (ownerId) {
    const u = await prisma.user.findUnique({ where: { id: ownerId } });
    if (u) {
      adminId = ownerId;
      return;
    }
  }
  const u = await prisma.user.create({
    data: { email: `test-admin-${Date.now()}@example.com`, name: "Test Admin" },
  });
  adminId = u.id as string;
});

afterEach(async () => {
  await prisma.subscriber.deleteMany({
    where: { name: { startsWith: "test-sub-" } },
  });
});

describe("subscriber service", () => {
  it("creates a subscriber and returns the plaintext code once", async () => {
    const result = await createSubscriber({
      name: "test-sub-alpha",
      createdById: adminId,
    });
    expect(result.code).toMatch(/^gil-[a-z0-9]+$/);
    expect(result.subscriber.name).toBe("test-sub-alpha");
    expect((result.subscriber as { codeHash?: string }).codeHash).toBeUndefined();
  });

  it("findSubscriberByCode returns the row for a valid code", async () => {
    const { code } = await createSubscriber({
      name: "test-sub-beta",
      createdById: adminId,
    });
    const found = await findSubscriberByCode(code);
    expect(found?.name).toBe("test-sub-beta");
  });

  it("findSubscriberByCode returns null for revoked subscribers", async () => {
    const { code, subscriber } = await createSubscriber({
      name: "test-sub-gamma",
      createdById: adminId,
    });
    await updateSubscriber(subscriber.id, { revoked: true });
    expect(await findSubscriberByCode(code)).toBeNull();
  });

  it("regenerateCode invalidates the old code", async () => {
    const { code: oldCode, subscriber } = await createSubscriber({
      name: "test-sub-delta",
      createdById: adminId,
    });
    const { code: newCode } = await regenerateCode(subscriber.id);
    expect(newCode).not.toBe(oldCode);
    expect(await findSubscriberByCode(oldCode)).toBeNull();
    expect((await findSubscriberByCode(newCode))?.id).toBe(subscriber.id);
  });

  it("listSubscribers returns rows without the codeHash", async () => {
    await createSubscriber({ name: "test-sub-epsilon", createdById: adminId });
    const list = await listSubscribers();
    const row = list.find((s) => s.name === "test-sub-epsilon");
    expect(row).toBeDefined();
    expect((row as { codeHash?: string }).codeHash).toBeUndefined();
  });

  it("deleteSubscriber removes the row", async () => {
    const { subscriber } = await createSubscriber({
      name: "test-sub-zeta",
      createdById: adminId,
    });
    await deleteSubscriber(subscriber.id);
    expect(await prisma.subscriber.findUnique({ where: { id: subscriber.id } })).toBeNull();
  });

  it("derives a simple lowercase code from the subscriber name", async () => {
    const { code } = await createSubscriber({
      name: "test-sub-Bob",
      createdById: adminId,
    });
    // No random suffix, no uppercase — exact name-based code.
    expect(code).toBe("gil-testsubbob");
  });

  it("findSubscriberByCode is case-insensitive on the typed code", async () => {
    const { code } = await createSubscriber({
      name: "test-sub-case",
      createdById: adminId,
    });
    expect(code).toBe("gil-testsubcase");
    expect((await findSubscriberByCode(code))?.name).toBe("test-sub-case");
    expect((await findSubscriberByCode(code.toUpperCase()))?.name).toBe("test-sub-case");
    expect((await findSubscriberByCode("Gil-TestSubCase"))?.name).toBe("test-sub-case");
    expect((await findSubscriberByCode("  gil-testsubcase  "))?.name).toBe("test-sub-case");
  });

  it("rejects an unrelated code regardless of case", async () => {
    await createSubscriber({ name: "test-sub-isolation", createdById: adminId });
    expect(await findSubscriberByCode("gil-NoSuchCode")).toBeNull();
    expect(await findSubscriberByCode("GIL-NOSUCHCODE")).toBeNull();
  });

  it("regenerateCode produces a different plaintext than the current one", async () => {
    const { code: c1, subscriber } = await createSubscriber({
      name: "test-sub-rotate",
      createdById: adminId,
    });
    const { code: c2 } = await regenerateCode(subscriber.id);
    expect(c2).not.toBe(c1);
    // Old code no longer signs in.
    expect(await findSubscriberByCode(c1)).toBeNull();
    expect((await findSubscriberByCode(c2))?.id).toBe(subscriber.id);
  });
});
