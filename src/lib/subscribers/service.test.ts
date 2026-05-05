import { describe, it, expect, beforeAll, afterEach } from "vitest";
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
  // The schema uses createdById -> User. Reuse the OWNER_USER_ID from env if present;
  // otherwise create a transient admin row for the test run.
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
  adminId = u.id;
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
    expect(result.code).toMatch(/^gil-[a-z0-9]{8}$/);
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
});
