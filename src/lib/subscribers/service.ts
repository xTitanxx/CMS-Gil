import { prisma } from "@/lib/prisma";
import {
  appendRandomSuffix,
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

// bcrypt is non-deterministic, so the @unique on codeHash does not protect
// against same-plaintext collisions. We must actively scan candidate hashes
// at creation time to detect "already in use" and pick a free variant.
async function isCodeAlreadyInUse(code: string): Promise<boolean> {
  const candidates = await prisma.subscriber.findMany({
    where: { revokedAt: null },
    select: { codeHash: true },
  });
  for (const c of candidates) {
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
  const row = await prisma.subscriber.create({
    data: {
      name: params.name,
      email: params.email?.trim() ? params.email.trim() : null,
      codeHash,
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
