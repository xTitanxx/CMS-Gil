import { prisma } from "@/lib/prisma";
import {
  appendRandomSuffix,
  blindIndex,
  deriveCodeFromName,
  generateCode,
  hashCode,
  isWellFormedCode,
  verifyCode,
} from "./code";

const PUBLIC_FIELDS = {
  id: true,
  name: true,
  email: true,
  displayName: true,
  monthlyBudgetUsd: true,
  cycleStart: true,
  cycleUsedUsd: true,
  createdAt: true,
  lastSeenAt: true,
  revokedAt: true,
  commentsDisabledAt: true,
  createdById: true,
} as const;

const MAX_COLLISION_SUFFIX = 20;

export type PublicSubscriber = {
  id: string;
  name: string;
  email: string | null;
  displayName: string | null;
  monthlyBudgetUsd: number;
  cycleStart: Date;
  cycleUsedUsd: number;
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  commentsDisabledAt: Date | null;
  createdById: string;
};

function toPublic(row: {
  id: string;
  name: string;
  email: string | null;
  displayName: string | null;
  monthlyBudgetUsd: { toNumber(): number };
  cycleStart: Date;
  cycleUsedUsd: { toNumber(): number };
  createdAt: Date;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  commentsDisabledAt: Date | null;
  createdById: string;
}): PublicSubscriber {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    displayName: row.displayName,
    monthlyBudgetUsd: row.monthlyBudgetUsd.toNumber(),
    cycleStart: row.cycleStart,
    cycleUsedUsd: row.cycleUsedUsd.toNumber(),
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    commentsDisabledAt: row.commentsDisabledAt,
    createdById: row.createdById,
  };
}

// Detect whether a given plaintext code is in use. Fast path uses the blind
// index; legacy rows that pre-date the index column fall back to the O(N)
// bcrypt scan against rows with codeBlindIndex == null.
async function isCodeAlreadyInUse(code: string): Promise<boolean> {
  const idx = blindIndex(code);
  const fast = await prisma.subscriber.findFirst({
    where: { codeBlindIndex: idx, revokedAt: null },
    select: { id: true },
  });
  if (fast) return true;
  const legacy = await prisma.subscriber.findMany({
    where: { revokedAt: null, codeBlindIndex: null },
    select: { codeHash: true },
  });
  for (const c of legacy) {
    if (await verifyCode(code, c.codeHash)) return true;
  }
  return false;
}

async function pickAvailableCode(base: string): Promise<string> {
  if (!(await isCodeAlreadyInUse(base))) return base;
  for (let n = 2; n <= MAX_COLLISION_SUFFIX; n++) {
    const candidate = `${base}${n}`;
    if (!(await isCodeAlreadyInUse(candidate))) return candidate;
  }
  throw new Error("Too many subscribers share this name; please customize the password");
}

export class InvalidCodeError extends Error {
  constructor(message = "Invalid subscriber code format") {
    super(message);
    this.name = "InvalidCodeError";
  }
}

export async function createSubscriber(params: {
  name: string;
  email?: string | null;
  code?: string;
  createdById: string;
  monthlyBudgetUsd?: number;
}): Promise<{ code: string; subscriber: PublicSubscriber }> {
  const requested = (params.code ?? deriveCodeFromName(params.name) ?? "").trim();
  const base = requested || generateCode();
  if (!isWellFormedCode(base)) {
    throw new InvalidCodeError();
  }
  const finalCode = await pickAvailableCode(base);
  const codeHash = await hashCode(finalCode);
  const codeBlindIndex = blindIndex(finalCode);
  const row = await prisma.subscriber.create({
    data: {
      name: params.name,
      email: params.email?.trim() ? params.email.trim() : null,
      codeHash,
      codeBlindIndex,
      createdById: params.createdById,
      ...(params.monthlyBudgetUsd !== undefined
        ? { monthlyBudgetUsd: params.monthlyBudgetUsd }
        : {}),
    },
    select: PUBLIC_FIELDS,
  });
  return { code: finalCode, subscriber: toPublic(row) };
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
  patch: {
    name?: string;
    email?: string | null;
    monthlyBudgetUsd?: number;
    revoked?: boolean;
    commentsDisabled?: boolean;
  }
): Promise<PublicSubscriber> {
  const row = await prisma.subscriber.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined
        ? { email: patch.email && patch.email.trim() ? patch.email.trim() : null }
        : {}),
      ...(patch.monthlyBudgetUsd !== undefined
        ? { monthlyBudgetUsd: patch.monthlyBudgetUsd }
        : {}),
      ...(patch.revoked !== undefined
        ? { revokedAt: patch.revoked ? new Date() : null }
        : {}),
      ...(patch.commentsDisabled !== undefined
        ? { commentsDisabledAt: patch.commentsDisabled ? new Date() : null }
        : {}),
    },
    select: PUBLIC_FIELDS,
  });
  return toPublic(row);
}

export async function regenerateCode(
  id: string
): Promise<{ code: string; subscriber: PublicSubscriber }> {
  const existing = await prisma.subscriber.findUnique({
    where: { id },
    select: { name: true },
  });
  if (!existing) throw new Error("Subscriber not found");

  const base = deriveCodeFromName(existing.name);
  const code = base ? appendRandomSuffix(base) : generateCode();
  const codeHash = await hashCode(code);
  const codeBlindIndex = blindIndex(code);
  const row = await prisma.subscriber.update({
    where: { id },
    data: { codeHash, codeBlindIndex },
    select: PUBLIC_FIELDS,
  });
  return { code, subscriber: toPublic(row) };
}

export async function deleteSubscriber(id: string): Promise<void> {
  await prisma.subscriber.delete({ where: { id } });
}

// Sign-in lookup. Fast path uses the blind index; if the row pre-dates the
// index column (codeBlindIndex == null) we fall back to the legacy O(N) scan
// and backfill the index on first match, so the next sign-in is fast.
export async function findSubscriberByCode(code: string): Promise<{
  id: string;
  name: string;
} | null> {
  const idx = blindIndex(code);

  const fast = await prisma.subscriber.findFirst({
    where: { codeBlindIndex: idx, revokedAt: null },
    select: { id: true, name: true, codeHash: true },
  });
  if (fast) {
    if (await verifyCode(code, fast.codeHash)) {
      return { id: fast.id, name: fast.name };
    }
    // Index hit but bcrypt mismatch: shouldn't happen unless the index column
    // was tampered with directly. Treat as no match.
    return null;
  }

  // Legacy backfill path: scan rows that don't have an index yet.
  const legacy = await prisma.subscriber.findMany({
    where: { revokedAt: null, codeBlindIndex: null },
    select: { id: true, name: true, codeHash: true },
  });
  for (const c of legacy) {
    if (await verifyCode(code, c.codeHash)) {
      // Backfill so the next sign-in for this subscriber is O(1).
      await prisma.subscriber
        .update({ where: { id: c.id }, data: { codeBlindIndex: idx } })
        .catch(() => {});
      return { id: c.id, name: c.name };
    }
  }
  return null;
}
