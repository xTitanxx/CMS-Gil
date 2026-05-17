import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  appendRandomSuffix,
  blindIndex,
  blindIndexRaw,
  deriveCodeFromName,
  generateCode,
  hashCode,
  isWellFormedCode,
  normalizeCode,
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
// bcrypt scan against rows with codeBlindIndex == null. `excludeId` skips a
// given row — used by regenerate so a subscriber can keep their simple name
// even though they themselves "currently hold" that code.
async function isCodeAlreadyInUse(code: string, excludeId?: string): Promise<boolean> {
  const idx = blindIndex(code);
  const fast = await prisma.subscriber.findFirst({
    where: {
      codeBlindIndex: idx,
      revokedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (fast) return true;
  const legacy = await prisma.subscriber.findMany({
    where: {
      revokedAt: null,
      codeBlindIndex: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { codeHash: true },
  });
  for (const c of legacy) {
    if (await verifyCode(code, c.codeHash)) return true;
  }
  return false;
}

async function pickAvailableCode(base: string, excludeId?: string): Promise<string> {
  if (!(await isCodeAlreadyInUse(base, excludeId))) return base;
  for (let n = 2; n <= MAX_COLLISION_SUFFIX; n++) {
    const candidate = `${base}${n}`;
    if (!(await isCodeAlreadyInUse(candidate, excludeId))) return candidate;
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
  const requested = normalizeCode(params.code ?? deriveCodeFromName(params.name) ?? "");
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
    select: { name: true, codeHash: true },
  });
  if (!existing) throw new Error("Subscriber not found");

  const base = deriveCodeFromName(existing.name);
  let code: string;
  if (base) {
    const candidate = await pickAvailableCode(base, id);
    // If the simple name is free AND it's not the row's current code (which
    // would mean rotating to the same plaintext, leaving the old hash valid),
    // use it. Otherwise tack on a short random suffix to guarantee rotation.
    const sameAsCurrent = await verifyCode(candidate, existing.codeHash);
    code = sameAsCurrent ? appendRandomSuffix(base) : candidate;
  } else {
    code = generateCode();
  }
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

// Sign-in lookup. `blindIndex` and `verifyCode` both normalize (lowercase)
// the input, so a user typing `Gil-Bob` matches a stored `gil-bob`.
//
// Three lookup paths in order of cost:
//   1. Fast: blindIndex(normalized) — hits any row indexed in lowercase form.
//   2. Case-fallback: blindIndex(as-typed) when input contains uppercase —
//      hits legacy rows that were indexed under their original mixed-case
//      plaintext (pre-normalize). On match, rehash to lowercase so the row
//      moves onto the fast path.
//   3. Legacy: O(N) scan over rows with codeBlindIndex == null — the
//      pre-blind-index migration backfill scope. Unchanged from before.
//
// Steps 1 and 2 are constant-time. Step 3 is bounded by null-indexed rows
// (zero in steady state once backfill finishes), so wrong-password attempts
// don't trigger an all-subscribers bcrypt scan.
export async function findSubscriberByCode(code: string): Promise<{
  id: string;
  name: string;
} | null> {
  const idx = blindIndex(code);
  const trimmed = code.trim();

  const fast = await prisma.subscriber.findFirst({
    where: { codeBlindIndex: idx, revokedAt: null },
    select: { id: true, name: true, codeHash: true },
  });
  if (fast) {
    if (await verifyCode(code, fast.codeHash)) {
      return { id: fast.id, name: fast.name };
    }
    return null;
  }

  // Case-fallback: try the as-typed (non-normalized) index for legacy rows
  // that were stored case-mixed. We only do this when input actually differs
  // from its lowercased form — otherwise this is the same lookup as `fast`.
  if (trimmed.toLowerCase() !== trimmed) {
    const rawIdx = blindIndexRaw(trimmed);
    const cased = await prisma.subscriber.findFirst({
      where: { codeBlindIndex: rawIdx, revokedAt: null },
      select: { id: true, name: true, codeHash: true },
    });
    if (cased && (await bcrypt.compare(trimmed, cased.codeHash))) {
      // Migrate this row to the normalized hash + index.
      const newHash = await hashCode(trimmed);
      await prisma.subscriber
        .update({ where: { id: cased.id }, data: { codeHash: newHash, codeBlindIndex: idx } })
        .catch(() => {});
      return { id: cased.id, name: cased.name };
    }
  }

  // Legacy backfill: rows that pre-date the blind-index column.
  const legacy = await prisma.subscriber.findMany({
    where: { revokedAt: null, codeBlindIndex: null },
    select: { id: true, name: true, codeHash: true },
  });
  for (const c of legacy) {
    // Try the normalized form (rows whose plaintext was already lowercase),
    // then the as-typed trimmed form (rows hashed from case-mixed plaintext).
    const normalizedHit = await verifyCode(code, c.codeHash);
    const rawHit =
      !normalizedHit && trimmed.toLowerCase() !== trimmed
        ? await bcrypt.compare(trimmed, c.codeHash)
        : false;
    if (normalizedHit || rawHit) {
      const data = rawHit
        ? { codeHash: await hashCode(trimmed), codeBlindIndex: idx }
        : { codeBlindIndex: idx };
      await prisma.subscriber.update({ where: { id: c.id }, data }).catch(() => {});
      return { id: c.id, name: c.name };
    }
  }
  return null;
}

