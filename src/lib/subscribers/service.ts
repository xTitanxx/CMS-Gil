import { prisma } from "@/lib/prisma";
import { generateCode, hashCode, verifyCode } from "./code";

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  monthlyBudgetUsd: true,
  cycleStart: true,
  cycleUsedUsd: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
  createdById: true,
} as const;

export type PublicSubscriber = {
  id: string;
  name: string;
  monthlyBudgetUsd: number;
  cycleStart: Date;
  cycleUsedUsd: number;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdById: string;
};

function toPublic(row: {
  id: string;
  name: string;
  monthlyBudgetUsd: { toNumber(): number };
  cycleStart: Date;
  cycleUsedUsd: { toNumber(): number };
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  createdById: string;
}): PublicSubscriber {
  return {
    id: row.id,
    name: row.name,
    monthlyBudgetUsd: row.monthlyBudgetUsd.toNumber(),
    cycleStart: row.cycleStart,
    cycleUsedUsd: row.cycleUsedUsd.toNumber(),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    createdById: row.createdById,
  };
}

export async function createSubscriber(params: {
  name: string;
  createdById: string;
  monthlyBudgetUsd?: number;
}): Promise<{ code: string; subscriber: PublicSubscriber }> {
  const code = generateCode();
  const codeHash = await hashCode(code);
  const row = await prisma.subscriber.create({
    data: {
      name: params.name,
      codeHash,
      createdById: params.createdById,
      ...(params.monthlyBudgetUsd !== undefined
        ? { monthlyBudgetUsd: params.monthlyBudgetUsd }
        : {}),
    },
    select: PUBLIC_FIELDS,
  });
  return { code, subscriber: toPublic(row) };
}

export async function listSubscribers(): Promise<PublicSubscriber[]> {
  const rows = await prisma.subscriber.findMany({
    select: PUBLIC_FIELDS,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toPublic);
}

export async function updateSubscriber(
  id: string,
  patch: { name?: string; monthlyBudgetUsd?: number; revoked?: boolean }
): Promise<PublicSubscriber> {
  const row = await prisma.subscriber.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.monthlyBudgetUsd !== undefined
        ? { monthlyBudgetUsd: patch.monthlyBudgetUsd }
        : {}),
      ...(patch.revoked !== undefined
        ? { revokedAt: patch.revoked ? new Date() : null }
        : {}),
    },
    select: PUBLIC_FIELDS,
  });
  return toPublic(row);
}

export async function regenerateCode(
  id: string
): Promise<{ code: string; subscriber: PublicSubscriber }> {
  const code = generateCode();
  const codeHash = await hashCode(code);
  const row = await prisma.subscriber.update({
    where: { id },
    data: { codeHash },
    select: PUBLIC_FIELDS,
  });
  return { code, subscriber: toPublic(row) };
}

export async function deleteSubscriber(id: string): Promise<void> {
  await prisma.subscriber.delete({ where: { id } });
}

export async function findSubscriberByCode(code: string): Promise<{
  id: string;
  name: string;
} | null> {
  // bcrypt hashes are non-deterministic; we must scan candidate rows.
  // Optimization: only consider non-revoked rows.
  const candidates = await prisma.subscriber.findMany({
    where: { revokedAt: null },
    select: { id: true, name: true, codeHash: true },
  });
  for (const c of candidates) {
    if (await verifyCode(code, c.codeHash)) {
      return { id: c.id, name: c.name };
    }
  }
  return null;
}
