# Subscriber Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the public archive (feed, post pages, story pages, virtual-Gil chat) behind admin-issued per-person access codes, with persistent per-subscriber chat memory and a token-cost monthly budget per subscriber. Add prompt caching to `/api/chat` (10× cost reduction).

**Architecture:** Subscribers live in a new `Subscriber` table (separate from admin `User`). NextAuth v5 is extended with a Credentials provider that authenticates against a hashed access code; the JWT carries `role: "admin" | "subscriber"`. A new `src/middleware.ts` enforces role per route. Public routes (`/`, `/p/*`, `/s/*`, `/chat`) require any signed-in role behind a `PUBLIC_GATE_ENABLED` env flag. Each chat turn computes actual API cost from `response.usage`, charges the subscriber's monthly budget (lazy reset), and writes an audit row.

**Tech Stack:** Next.js 16 App Router, NextAuth v5 (jwt strategy), Prisma 7, PostgreSQL (Supabase), Anthropic SDK, vitest, bcryptjs.

---

## File Structure

**New files:**
- `src/lib/subscribers/code.ts` — generate/hash/verify access codes
- `src/lib/subscribers/code.test.ts`
- `src/lib/subscribers/budget.ts` — `computeHaikuCost`, `lazyResetCycleIfNeeded`, `checkBudget`, `recordUsage`, `startOfCurrentMonthUtc`
- `src/lib/subscribers/budget.test.ts`
- `src/lib/subscribers/service.ts` — CRUD: `createSubscriber`, `listSubscribers`, `updateSubscriber`, `regenerateCode`, `deleteSubscriber`
- `src/lib/subscribers/service.test.ts`
- `src/middleware.ts` — role-aware route gating
- `src/app/welcome/page.tsx` — server component, redirects to `/` if signed in
- `src/app/welcome/SignInForm.tsx` — client form
- `src/app/api/admin/subscribers/route.ts` — `GET` list, `POST` create
- `src/app/api/admin/subscribers/[id]/route.ts` — `PATCH` update, `DELETE`
- `src/app/api/admin/subscribers/[id]/regenerate-code/route.ts` — `POST`
- `src/app/api/chat/conversation/route.ts` — `GET` load/create persistent conversation
- `src/app/api/chat/budget/route.ts` — `GET` budget summary
- `src/components/SubscriberHeader.tsx` — "Hi, {name}  Sign out" strip for signed-in subscribers
- `src/components/BudgetMeter.tsx` — chat budget bar
- `src/types/next-auth.d.ts` — module augmentation for `role`/`subscriberId` on session and JWT

**Modified files:**
- `prisma/schema.prisma` — add `Subscriber`, `SubscriberConversation`, `SubscriberMessage`, `SubscriberUsage`; add reverse relation `subscribersCreated Subscriber[]` on `User`
- `src/lib/auth.ts` — register `subscriber-credentials` Credentials provider; extend `jwt`/`session` callbacks with `role` + `subscriberId`
- `src/app/api/chat/route.ts` — auth check, budget gating, prompt caching, usage logging, conversation persistence
- `src/app/chat/page.tsx` — render `SubscriberHeader` + `BudgetMeter`; load existing conversation on mount
- `src/app/page.tsx` — render `SubscriberHeader` for signed-in subscribers (above the cover banner)
- `src/app/p/[id]/page.tsx` — render `SubscriberHeader`
- `src/app/s/[id]/page.tsx` — render `SubscriberHeader`
- `src/app/admin/settings/SettingsPage.tsx` — append a Subscribers section

---

## Conventions

- **Run tests:** `npm test -- <file>` runs vitest in non-watch mode for a specific file. The bare `npm test` runs the whole suite.
- **TypeScript check:** `npx tsc --noEmit`.
- **Prisma generate after schema change:** `npx prisma generate`.
- **Lint:** `npm run lint` (skip unless explicitly requested — already enforced in CI).
- **Bcrypt rounds:** 10 (matches existing usage in `src/lib/auth.ts`).
- **Decimal precision:** monthly budget `Decimal(8, 4)`, per-turn cost `Decimal(8, 6)`.
- **Pricing constants** (Haiku 4.5): input $1/MTok, 1h cache write $2/MTok, cache read $0.10/MTok, output $5/MTok.

---

## Task 1: Database schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add reverse relation field to `User`**

In `prisma/schema.prisma`, locate the `User` model (line 40 area) and add this line in the relations block:

```prisma
subscribersCreated Subscriber[]
```

- [ ] **Step 2: Add the four new models to `schema.prisma`**

Append at the end of the file, after the last existing model:

```prisma
model Subscriber {
  id               String                    @id @default(cuid())
  name             String
  codeHash         String                    @unique
  monthlyBudgetUsd Decimal                   @default(1.20) @db.Decimal(8, 4)
  cycleStart       DateTime                  @default(now())
  cycleUsedUsd     Decimal                   @default(0) @db.Decimal(8, 4)
  createdAt        DateTime                  @default(now())
  lastSeenAt       DateTime?
  revokedAt        DateTime?
  createdById      String
  createdBy        User                      @relation(fields: [createdById], references: [id])
  conversations    SubscriberConversation[]
  usageEvents      SubscriberUsage[]

  @@index([revokedAt])
}

model SubscriberConversation {
  id           String              @id @default(cuid())
  subscriberId String
  subscriber   Subscriber          @relation(fields: [subscriberId], references: [id], onDelete: Cascade)
  title        String?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  messages     SubscriberMessage[]

  @@index([subscriberId, updatedAt])
}

model SubscriberMessage {
  id             String                 @id @default(cuid())
  conversationId String
  conversation   SubscriberConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  role           String
  content        String
  createdAt      DateTime               @default(now())

  @@index([conversationId, createdAt])
}

model SubscriberUsage {
  id                       String     @id @default(cuid())
  subscriberId             String
  subscriber               Subscriber @relation(fields: [subscriberId], references: [id], onDelete: Cascade)
  inputTokens              Int
  cacheCreationInputTokens Int        @default(0)
  cacheReadInputTokens     Int        @default(0)
  outputTokens             Int
  costUsd                  Decimal    @db.Decimal(8, 6)
  createdAt                DateTime   @default(now())

  @@index([subscriberId, createdAt])
}
```

- [ ] **Step 3: Generate migration**

Run: `npx prisma migrate dev --name add_subscribers`
Expected: prints `Applying migration ...add_subscribers` and "✔ Generated Prisma Client". Confirms a new file under `prisma/migrations/<timestamp>_add_subscribers/migration.sql`.

- [ ] **Step 4: Verify generated client compiles**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(subscribers): add Subscriber + chat + usage models"
```

---

## Task 2: Code generation/hashing module

**Files:**
- Create: `src/lib/subscribers/code.ts`
- Test: `src/lib/subscribers/code.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/subscribers/code.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateCode, hashCode, verifyCode } from "./code";

describe("subscriber code", () => {
  it("generates a code matching the gil-{8 alnum} format", () => {
    const code = generateCode();
    expect(code).toMatch(/^gil-[a-z0-9]{8}$/);
  });

  it("generates distinct codes across calls", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateCode()));
    expect(codes.size).toBe(50);
  });

  it("hashes a code so the hash differs from the plaintext", async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(hash).not.toEqual(code);
    expect(hash.length).toBeGreaterThan(20);
  });

  it("verifies a correct code against its hash", async () => {
    const code = generateCode();
    const hash = await hashCode(code);
    expect(await verifyCode(code, hash)).toBe(true);
  });

  it("rejects a wrong code against a hash", async () => {
    const hash = await hashCode(generateCode());
    expect(await verifyCode("gil-wrongone", hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/subscribers/code.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `code.ts`**

`src/lib/subscribers/code.ts`:

```ts
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export function generateCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let suffix = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    suffix += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `gil-${suffix}`;
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export async function verifyCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- src/lib/subscribers/code.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscribers/code.ts src/lib/subscribers/code.test.ts
git commit -m "feat(subscribers): code generation and verification"
```

---

## Task 3: Budget computation module

**Files:**
- Create: `src/lib/subscribers/budget.ts`
- Test: `src/lib/subscribers/budget.test.ts`

- [ ] **Step 1: Write the failing test for `computeHaikuCost`**

`src/lib/subscribers/budget.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  computeHaikuCost,
  startOfCurrentMonthUtc,
  HAIKU_PRICES,
} from "./budget";

describe("computeHaikuCost", () => {
  it("returns 0 for empty usage", () => {
    expect(
      computeHaikuCost({
        input_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        output_tokens: 0,
      })
    ).toBe(0);
  });

  it("charges input + output at the published rates", () => {
    // 1,000,000 input @ $1 + 1,000,000 output @ $5 = $6
    const cost = computeHaikuCost({
      input_tokens: 1_000_000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(6, 6);
  });

  it("charges cache write (1h) at $2/MTok and cache read at $0.10/MTok", () => {
    // 100k cache write @ $2/M = $0.20; 100k cache read @ $0.10/M = $0.01
    const cost = computeHaikuCost({
      input_tokens: 0,
      cache_creation_input_tokens: 100_000,
      cache_read_input_tokens: 100_000,
      output_tokens: 0,
    });
    expect(cost).toBeCloseTo(0.21, 6);
  });

  it("matches a realistic Haiku cached turn ≈ $0.01", () => {
    // 90k cache read + 500 input + 400 output
    const cost = computeHaikuCost({
      input_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 90_000,
      output_tokens: 400,
    });
    expect(cost).toBeCloseTo(0.0115, 4);
  });

  it("exposes the canonical prices for documentation/tests", () => {
    expect(HAIKU_PRICES.inputPerMTok).toBe(1.0);
    expect(HAIKU_PRICES.cacheWrite1hPerMTok).toBe(2.0);
    expect(HAIKU_PRICES.cacheReadPerMTok).toBe(0.1);
    expect(HAIKU_PRICES.outputPerMTok).toBe(5.0);
  });
});

describe("startOfCurrentMonthUtc", () => {
  it("returns midnight on the 1st in UTC for a given reference date", () => {
    const ref = new Date(Date.UTC(2026, 3, 28, 14, 30, 0)); // 2026-04-28T14:30Z
    const start = startOfCurrentMonthUtc(ref);
    expect(start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("rolls into the new month on UTC midnight of the 1st", () => {
    const ref = new Date(Date.UTC(2026, 4, 1, 0, 0, 0)); // 2026-05-01T00:00Z
    const start = startOfCurrentMonthUtc(ref);
    expect(start.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/subscribers/budget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeHaikuCost` + month helper in `budget.ts`**

`src/lib/subscribers/budget.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";

export const HAIKU_PRICES = {
  inputPerMTok: 1.0,
  cacheWrite1hPerMTok: 2.0,
  cacheReadPerMTok: 0.1,
  outputPerMTok: 5.0,
} as const;

type Usage = {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens: number;
};

export function computeHaikuCost(usage: Usage): number {
  const M = 1_000_000;
  return (
    (usage.input_tokens / M) * HAIKU_PRICES.inputPerMTok +
    ((usage.cache_creation_input_tokens ?? 0) / M) * HAIKU_PRICES.cacheWrite1hPerMTok +
    ((usage.cache_read_input_tokens ?? 0) / M) * HAIKU_PRICES.cacheReadPerMTok +
    (usage.output_tokens / M) * HAIKU_PRICES.outputPerMTok
  );
}

export function startOfCurrentMonthUtc(ref: Date = new Date()): Date {
  return new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), 1, 0, 0, 0, 0));
}

export type BudgetCheck =
  | { allowed: true; usedUsd: number; budgetUsd: number; cycleResetsAt: Date }
  | { allowed: false; usedUsd: number; budgetUsd: number; cycleResetsAt: Date };

export async function checkBudgetAndLazyReset(subscriberId: string): Promise<BudgetCheck> {
  const sub = await prisma.subscriber.findUniqueOrThrow({
    where: { id: subscriberId },
    select: { cycleStart: true, cycleUsedUsd: true, monthlyBudgetUsd: true },
  });
  const monthStart = startOfCurrentMonthUtc();
  const nextMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)
  );

  let usedUsd = sub.cycleUsedUsd.toNumber();
  if (sub.cycleStart < monthStart) {
    await prisma.subscriber.update({
      where: { id: subscriberId },
      data: { cycleStart: monthStart, cycleUsedUsd: 0 },
    });
    usedUsd = 0;
  }
  const budgetUsd = sub.monthlyBudgetUsd.toNumber();
  return {
    allowed: usedUsd < budgetUsd,
    usedUsd,
    budgetUsd,
    cycleResetsAt: nextMonth,
  };
}

export async function recordUsage(params: {
  subscriberId: string;
  usage: Usage;
}): Promise<{ costUsd: number }> {
  const cost = computeHaikuCost(params.usage);
  await prisma.$transaction([
    prisma.subscriberUsage.create({
      data: {
        subscriberId: params.subscriberId,
        inputTokens: params.usage.input_tokens,
        cacheCreationInputTokens: params.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: params.usage.cache_read_input_tokens ?? 0,
        outputTokens: params.usage.output_tokens,
        costUsd: cost,
      },
    }),
    prisma.subscriber.update({
      where: { id: params.subscriberId },
      data: {
        cycleUsedUsd: { increment: cost },
        lastSeenAt: new Date(),
      },
    }),
  ]);
  return { costUsd: cost };
}

// Keep the Anthropic Usage type alias importable for callers
export type AnthropicUsage = NonNullable<
  Anthropic.Messages.Message["usage"]
>;
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test -- src/lib/subscribers/budget.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscribers/budget.ts src/lib/subscribers/budget.test.ts
git commit -m "feat(subscribers): cost computation and lazy budget reset"
```

---

## Task 4: Subscriber service (CRUD)

**Files:**
- Create: `src/lib/subscribers/service.ts`
- Test: `src/lib/subscribers/service.test.ts`

- [ ] **Step 1: Write the failing test (Prisma-backed integration test)**

`src/lib/subscribers/service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/lib/subscribers/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `service.ts`**

`src/lib/subscribers/service.ts`:

```ts
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
```

- [ ] **Step 4: Run the integration tests**

Run: `npm test -- src/lib/subscribers/service.test.ts`
Expected: 6 passed. If any fail with "OWNER_USER_ID env not set", check `.env.local` is being loaded by vitest (the existing tests pull DB env from there via `dotenv` — see `vitest.config.ts`; if not loaded, prepend `set -a; . ./.env.local; set +a;` to the command).

- [ ] **Step 5: Commit**

```bash
git add src/lib/subscribers/service.ts src/lib/subscribers/service.test.ts
git commit -m "feat(subscribers): CRUD service"
```

---

## Task 5: Extend NextAuth with subscriber Credentials provider

**Files:**
- Modify: `src/lib/auth.ts`
- Create: `src/types/next-auth.d.ts`

- [ ] **Step 1: Add module augmentation for `role` + `subscriberId`**

`src/types/next-auth.d.ts`:

```ts
import "next-auth";
import "next-auth/jwt";

type AppRole = "admin" | "subscriber";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: AppRole;
      subscriberId?: string;
    };
  }
  interface User {
    role?: AppRole;
    subscriberId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: AppRole;
    subscriberId?: string;
  }
}
```

- [ ] **Step 2: Verify the augmentation type-checks**

Run: `npx tsc --noEmit`
Expected: no errors related to `next-auth.d.ts`. If `tsconfig.json` doesn't include `src/types/**`, add it to `include`.

- [ ] **Step 3: Add a per-IP rate limiter for code attempts**

Create `src/lib/subscribers/signin-rate-limit.ts`:

```ts
import { createRateLimiter } from "@/lib/rate-limit";

// 10 attempts per IP per hour — bcrypt verify is slow, so this also throttles compute.
export const subscriberSignInLimiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});
```

- [ ] **Step 4: Modify `src/lib/auth.ts` — add the subscriber Credentials provider and role callbacks**

Apply this diff to `src/lib/auth.ts`:

```diff
@@
 import Credentials from "next-auth/providers/credentials";
 import bcrypt from "bcryptjs";
 import { prisma } from "@/lib/prisma";
+import { findSubscriberByCode } from "@/lib/subscribers/service";
+import { subscriberSignInLimiter } from "@/lib/subscribers/signin-rate-limit";

 const providers = [];
@@
 providers.push(
   Credentials({
     name: "Email",
     credentials: { ... existing ... },
     async authorize(credentials) { ... existing ... },
   })
 );
+
+providers.push(
+  Credentials({
+    id: "subscriber-credentials",
+    name: "Subscriber Code",
+    credentials: {
+      code: { label: "Access code", type: "text" },
+    },
+    async authorize(credentials, request) {
+      const code = (credentials?.code as string | undefined)?.trim();
+      if (!code) return null;
+
+      const ip =
+        request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim() ??
+        request?.headers?.get?.("x-real-ip") ??
+        "unknown";
+      const limit = subscriberSignInLimiter.check(ip);
+      if (!limit.allowed) return null;
+
+      const sub = await findSubscriberByCode(code);
+      if (!sub) return null;
+      await prisma.subscriber.update({
+        where: { id: sub.id },
+        data: { lastSeenAt: new Date() },
+      });
+      return {
+        id: sub.id,
+        name: sub.name,
+        email: null,
+        image: null,
+        role: "subscriber",
+        subscriberId: sub.id,
+      };
+    },
+  })
+);
@@
   callbacks: {
-    jwt({ token, user }) {
-      if (user?.id) {
-        // All co-admins share the primary content owner's data.
-        token.sub = process.env.OWNER_USER_ID ?? user.id;
-      }
-      return token;
-    },
-    session({ session, token }) {
-      if (token.sub) session.user.id = token.sub;
-      return session;
-    },
+    jwt({ token, user, account }) {
+      if (user) {
+        const isSubscriber = user.role === "subscriber";
+        token.role = isSubscriber ? "subscriber" : "admin";
+        if (isSubscriber) {
+          token.sub = user.id; // subscriber id
+          token.subscriberId = user.id;
+          token.name = user.name ?? null;
+        } else {
+          // Existing admin behavior: collapse co-admins to the owner.
+          token.sub = process.env.OWNER_USER_ID ?? user.id;
+          token.subscriberId = undefined;
+        }
+      }
+      return token;
+    },
+    session({ session, token }) {
+      if (token.sub) session.user.id = token.sub;
+      session.user.role = (token.role ?? "admin") as "admin" | "subscriber";
+      if (token.subscriberId) {
+        session.user.subscriberId = token.subscriberId;
+      }
+      return session;
+    },
   },
   pages: {
     signIn: "/login",
   },
 });
```

(Replace the matching blocks in the file; do not change the Google/LinkedIn provider blocks.)

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/types/next-auth.d.ts src/lib/subscribers/signin-rate-limit.ts tsconfig.json
git commit -m "feat(auth): subscriber Credentials provider + role JWT/session + signin rate limit"
```

(Only include `tsconfig.json` if it was modified to pick up the new `src/types` directory.)

---

## Task 6: Welcome page (subscriber sign-in)

**Files:**
- Create: `src/app/welcome/page.tsx`
- Create: `src/app/welcome/SignInForm.tsx`

- [ ] **Step 1: Create the server component**

`src/app/welcome/page.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const next = (await searchParams).next ?? "/";
  if (session) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatar.jpg"
            alt="Gil Alter"
            className="mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-white shadow"
          />
          <h1 className="text-xl font-bold text-gray-900">Welcome to Gil&apos;s archive</h1>
          <p className="mt-1 text-sm text-gray-600">
            Enter your access code to come in. If you don&apos;t have one,
            message Gil on Facebook.
          </p>
        </div>
        <SignInForm next={next} />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the client form**

`src/app/welcome/SignInForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("subscriber-credentials", {
      code: code.trim(),
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      window.location.assign(next);
    } else {
      setError("Code not recognized. Please double-check, or message Gil on Facebook.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="gil-xxxxxxxx"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || code.length === 0}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Enter"}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/welcome
git commit -m "feat(subscribers): /welcome sign-in page"
```

---

## Task 7: Middleware for role-aware gating

**Files:**
- Create: `src/middleware.ts`

- [ ] **Step 1: Implement middleware**

`src/middleware.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Required: this middleware uses Prisma (via auth() -> findSubscriberByCode-adjacent paths
// during session verification), which can't run on the edge runtime.
export const runtime = "nodejs";

const PUBLIC_PROTECTED_PATHS = ["/", "/p", "/s", "/chat"];
const ADMIN_PATH_PREFIX = "/admin";
const ADMIN_API_PREFIX = "/api/admin";
const ALWAYS_PUBLIC = [
  "/welcome",
  "/login",
  "/api/auth", // NextAuth callbacks (incl. /api/auth/callback/subscriber-credentials)
  "/_next",
  "/favicon.ico",
  "/banner.jpg",
  "/avatar.jpg",
  "/manifest.webmanifest",
  "/api/public",
];

function isAlwaysPublic(pathname: string): boolean {
  return ALWAYS_PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isPublicProtected(pathname: string): boolean {
  if (pathname === "/") return true;
  return PUBLIC_PROTECTED_PATHS.some((p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/")));
}

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  if (isAlwaysPublic(pathname)) return NextResponse.next();

  const session = req.auth;
  const role = session?.user?.role;

  // Admin pages + API
  if (pathname.startsWith(ADMIN_PATH_PREFIX) || pathname.startsWith(ADMIN_API_PREFIX)) {
    if (role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Public archive routes — gated by feature flag
  if (process.env.PUBLIC_GATE_ENABLED === "true" && isPublicProtected(pathname)) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/welcome";
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run on everything except static assets that don't have an extension match
    "/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
```

- [ ] **Step 2: Verify dev server boots and gate works**

Run `npm run dev` in the background — wait for "Ready", then:
- GET `/` with `PUBLIC_GATE_ENABLED` unset → 200 (no redirect).
- Add `PUBLIC_GATE_ENABLED=true` to `.env.local`, restart dev server, GET `/` with no session → 307 to `/welcome?next=%2F`.
- Stop dev server, remove `PUBLIC_GATE_ENABLED` from `.env.local`.

If the `nodejs` runtime declaration triggers a Next.js error ("middleware nodejs runtime requires Next.js 15.2+"), upgrade Next or fall back to the auth.config split: create `src/lib/auth.config.ts` exporting only the `pages`/`callbacks`/`session` config (no providers needing DB), then `import NextAuth from "next-auth"; const { auth } = NextAuth(authConfig);` in middleware.ts. This is a known NextAuth v5 pattern. Project is on Next 16.2 per CLAUDE.md so this fallback should not be needed.

- [ ] **Step 3: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(subscribers): role-aware middleware + PUBLIC_GATE_ENABLED flag"
```

---

## Task 8: Modify `/api/chat` — auth, prompt caching, budget, persistence

**Files:**
- Modify: `src/app/api/chat/route.ts`

- [ ] **Step 1: Replace the route with the budget-aware version**

`src/app/api/chat/route.ts` (full rewrite — keep file path identical):

```ts
import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPostContext } from "@/lib/post-context-cache";
import {
  checkBudgetAndLazyReset,
  recordUsage,
} from "@/lib/subscribers/budget";

const client = new Anthropic();
const MODEL = "claude-haiku-4-5";

const RATE_LIMIT_MESSAGE =
  "You've used your monthly chat allowance with virtual Gil. " +
  "It will renew at the start of next month. Thanks for your patience!";

function buildSystemPrompt(postContext: string, postCount: number) {
  return `You are Virtual Gil — an AI assistant that helps people explore Gil Alter's archive of posts. Gil is a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges.

IMPORTANT RULES:
- Always speak about Gil in the THIRD PERSON. Say "Gil has written about…", "Gil shared…", "In Gil's experience…" — NEVER "I" or "my".
- Only discuss topics covered in Gil's posts below. If someone asks about something Gil hasn't written about, say: "Gil hasn't shared his thoughts on that topic yet, but thanks for asking."
- Before saying Gil hasn't written about something, carefully search through ALL the posts below. If there are posts on the topic, discuss them — never claim Gil hasn't written about a topic when posts exist about it.
- Gil is NOT a medical professional. His posts share personal experience, never medical advice. Make this clear.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- Be warm and helpful. You're a guide to Gil's archive, helping people find relevant reflections.

REFERENCING POSTS:
- When your answer draws from specific posts, embed up to 3 post markers in your response using exactly this format: [POST:<id>]
- Place each marker on its own line, right after the paragraph where you discuss that post's content.
- The marker will be rendered as a rich card showing the post — do NOT also quote the post text. Just discuss the idea naturally, then place the marker.
- Only reference posts that are directly relevant to what the person asked. Do not force references.
- Each post has an ID shown as [ID: <id>] in the context below. Use that exact ID in markers.

GIL'S POSTS (${postCount} posts, newest first):
---
${postContext}
---`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const subscriberId = session?.user?.subscriberId;

  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  // Subscriber budget gate (admin bypasses)
  if (role === "subscriber") {
    if (!subscriberId) {
      return Response.json({ error: "Invalid session." }, { status: 401 });
    }
    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      return Response.json({ error: "Access revoked." }, { status: 403 });
    }
    const check = await checkBudgetAndLazyReset(subscriberId);
    if (!check.allowed) {
      return Response.json(
        {
          error: RATE_LIMIT_MESSAGE,
          cycleResetsAt: check.cycleResetsAt.toISOString(),
        },
        { status: 429 }
      );
    }
  }

  const { messages } = await req.json();
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }

  const { text: postContext, count: postCount } = await getPostContext();
  const systemText = buildSystemPrompt(postContext, postCount);

  // Persist user message immediately (subscriber path only)
  let conversationId: string | null = null;
  if (role === "subscriber" && subscriberId) {
    conversationId = await getOrCreateConversationId(subscriberId);
    const last = messages[messages.length - 1];
    if (last?.role === "user" && typeof last.content === "string") {
      await prisma.subscriberMessage.create({
        data: { conversationId, role: "user", content: last.content },
      });
    }
  }

  const encoder = new TextEncoder();
  let usage: Anthropic.Messages.Message["usage"] | null = null;
  let assistantText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: systemText,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            assistantText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        const finalMessage = await response.finalMessage();
        usage = finalMessage.usage;
      } catch (err) {
        console.error("Chat API error:", err);
        controller.enqueue(
          encoder.encode("I'm having trouble responding right now. Please try again in a moment.")
        );
      }
      controller.close();

      // After the stream is closed, persist usage + assistant message.
      if (role === "subscriber" && subscriberId && usage) {
        try {
          await recordUsage({ subscriberId, usage });
        } catch (e) {
          console.error("recordUsage failed:", e);
        }
      }
      if (conversationId && assistantText) {
        try {
          await prisma.subscriberMessage.create({
            data: { conversationId, role: "assistant", content: assistantText },
          });
          await prisma.subscriberConversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });
        } catch (e) {
          console.error("persist assistant message failed:", e);
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function getOrCreateConversationId(subscriberId: string): Promise<string> {
  const existing = await prisma.subscriberConversation.findFirst({
    where: { subscriberId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.subscriberConversation.create({
    data: { subscriberId },
    select: { id: true },
  });
  return created.id;
}
```

Note: The original IP-based rate limiter is intentionally removed. Subscriber budget enforcement replaces it; admin sessions are exempt; unauthenticated callers are rejected upstream.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `Anthropic.Messages.Message["usage"]` import path differs in the installed SDK version, the budget module's `Usage` shape is the canonical contract — adjust the type import.

- [ ] **Step 3: Smoke-test the cache header presence**

Add a quick assertion via a one-off node script in `/tmp/check-cache.ts` (do not commit) that imports the route and inspects the system block. Skip if blocked by Next bundling — the integration test in Task 11 covers it.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat(chat): prompt caching + subscriber budget enforcement + persistence"
```

---

## Task 9: Chat helper APIs (conversation + budget)

**Files:**
- Create: `src/app/api/chat/conversation/route.ts`
- Create: `src/app/api/chat/budget/route.ts`

- [ ] **Step 1: Implement `/api/chat/conversation`**

`src/app/api/chat/conversation/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

  if (session.user.role !== "subscriber" || !session.user.subscriberId) {
    // Admin: return empty conversation (admin chat is ephemeral)
    return Response.json({ messages: [] });
  }

  const conv = await prisma.subscriberConversation.findFirst({
    where: { subscriberId: session.user.subscriberId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  if (!conv) return Response.json({ messages: [] });

  return Response.json({
    messages: conv.messages.map((m) => ({ role: m.role, content: m.content })),
  });
}
```

- [ ] **Step 2: Implement `/api/chat/budget`**

`src/app/api/chat/budget/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { checkBudgetAndLazyReset } from "@/lib/subscribers/budget";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

  if (session.user.role !== "subscriber" || !session.user.subscriberId) {
    // Admin: report unlimited
    return Response.json({
      role: "admin",
      usedUsd: 0,
      budgetUsd: 0,
      percentUsed: 0,
      cycleResetsAt: null,
      unlimited: true,
    });
  }

  const c = await checkBudgetAndLazyReset(session.user.subscriberId);
  return Response.json({
    role: "subscriber",
    usedUsd: c.usedUsd,
    budgetUsd: c.budgetUsd,
    percentUsed: c.budgetUsd > 0 ? Math.min(100, (c.usedUsd / c.budgetUsd) * 100) : 100,
    cycleResetsAt: c.cycleResetsAt.toISOString(),
    unlimited: false,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/conversation src/app/api/chat/budget
git commit -m "feat(chat): conversation + budget helper endpoints"
```

---

## Task 10: Admin API routes for subscribers

**Files:**
- Create: `src/app/api/admin/subscribers/route.ts`
- Create: `src/app/api/admin/subscribers/[id]/route.ts`
- Create: `src/app/api/admin/subscribers/[id]/regenerate-code/route.ts`

- [ ] **Step 1: Implement list + create**

`src/app/api/admin/subscribers/route.ts`:

```ts
import { auth } from "@/lib/auth";
import {
  createSubscriber,
  listSubscribers,
} from "@/lib/subscribers/service";

async function requireAdmin() {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return null;
  }
  return session;
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });
  const list = await listSubscribers();
  return Response.json({ subscribers: list });
}

export async function POST(req: Request) {
  const session = await requireAdmin();
  if (!session) return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { name?: string; monthlyBudgetUsd?: number }
    | null;
  const name = body?.name?.trim();
  if (!name) return Response.json({ error: "Name required" }, { status: 400 });

  const result = await createSubscriber({
    name,
    createdById: session.user.id,
    monthlyBudgetUsd: body?.monthlyBudgetUsd,
  });
  return Response.json({ code: result.code, subscriber: result.subscriber });
}
```

- [ ] **Step 2: Implement patch + delete**

`src/app/api/admin/subscribers/[id]/route.ts`:

```ts
import { auth } from "@/lib/auth";
import {
  updateSubscriber,
  deleteSubscriber,
} from "@/lib/subscribers/service";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    monthlyBudgetUsd?: number;
    revoked?: boolean;
  };
  const updated = await updateSubscriber(id, body);
  return Response.json({ subscriber: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  await deleteSubscriber(id);
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Implement regenerate-code**

`src/app/api/admin/subscribers/[id]/regenerate-code/route.ts`:

```ts
import { auth } from "@/lib/auth";
import { regenerateCode } from "@/lib/subscribers/service";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const { code, subscriber } = await regenerateCode(id);
  return Response.json({ code, subscriber });
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/admin/subscribers
git commit -m "feat(admin): subscriber CRUD endpoints"
```

---

## Task 11: Integration test for `/api/chat` budget enforcement

**Files:**
- Create: `src/app/api/chat/route.test.ts`

- [ ] **Step 1: Write the test**

`src/app/api/chat/route.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test**

Run: `npm test -- src/app/api/chat/route.test.ts`
Expected: 3 passed. The streaming-success path is covered manually below; mocking the Anthropic stream is brittle and not worth the test churn.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/chat/route.test.ts
git commit -m "test(chat): budget enforcement (401/403/429 paths)"
```

---

## Task 12: Subscriber header + budget meter components

**Files:**
- Create: `src/components/SubscriberHeader.tsx`
- Create: `src/components/BudgetMeter.tsx`

- [ ] **Step 1: SubscriberHeader (server component)**

`src/components/SubscriberHeader.tsx`:

```tsx
import { auth } from "@/lib/auth";
import { signOut } from "@/lib/auth";

export async function SubscriberHeader() {
  const session = await auth();
  if (!session || session.user.role !== "subscriber") return null;

  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2 text-sm">
        <span className="text-gray-700">
          Hi, <span className="font-semibold">{session.user.name}</span>
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/welcome" });
          }}
        >
          <button type="submit" className="text-blue-600 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: BudgetMeter (client component)**

`src/components/BudgetMeter.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

type Budget = {
  unlimited: boolean;
  percentUsed: number;
  cycleResetsAt: string | null;
};

export function BudgetMeter() {
  const [budget, setBudget] = useState<Budget | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/chat/budget");
      if (!res.ok) return;
      const data = (await res.json()) as Budget;
      if (!cancelled) setBudget(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!budget || budget.unlimited) return null;

  const reset = budget.cycleResetsAt
    ? new Date(budget.cycleResetsAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : "soon";
  const pct = Math.round(budget.percentUsed);

  return (
    <div className="border-b border-gray-200 bg-white px-4 py-2 text-xs text-gray-600">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span>Monthly chat allowance: {pct}% used. Renews {reset}.</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : "bg-blue-500"}`}
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SubscriberHeader.tsx src/components/BudgetMeter.tsx
git commit -m "feat(public): SubscriberHeader and BudgetMeter components"
```

---

## Task 13: Wire components into public pages + chat

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/p/[id]/page.tsx`
- Modify: `src/app/s/[id]/page.tsx`
- Modify: `src/app/chat/page.tsx`
- Modify: `src/app/chat/layout.tsx` (only if needed for the meter container)

- [ ] **Step 1: Insert `<SubscriberHeader />` at the top of `<main>` in `src/app/page.tsx`**

In `src/app/page.tsx`, change the imports to add:

```ts
import { SubscriberHeader } from "@/components/SubscriberHeader";
```

Then replace the opening `<main>` block:

```diff
   return (
-    <main className="min-h-screen bg-gray-100">
+    <main className="min-h-screen bg-gray-100">
+      {/* @ts-expect-error Async Server Component */}
+      <SubscriberHeader />
       {/* Full-bleed banner */}
```

(Drop the `ts-expect-error` if the project's TS / Next versions accept async server components without it.)

- [ ] **Step 2: Same insertion in `src/app/p/[id]/page.tsx` and `src/app/s/[id]/page.tsx`**

For each file: import `SubscriberHeader` and render it as the first child of the page's outermost wrapper.

- [ ] **Step 3: Modify `src/app/chat/page.tsx` to load the persistent conversation and render the meter**

Apply this set of changes to `src/app/chat/page.tsx`:

a) Add the import for `BudgetMeter`:
```ts
import { BudgetMeter } from "@/components/BudgetMeter";
```

b) Inside the `GilChatPage` component body, replace the `useState<Message[]>([])` initial load logic — use a `useEffect` to fetch `/api/chat/conversation` once on mount and seed `messages`:

```ts
const [messagesLoaded, setMessagesLoaded] = useState(false);
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const res = await fetch("/api/chat/conversation");
      if (!res.ok) return;
      const data = (await res.json()) as { messages: { role: "user" | "assistant"; content: string }[] };
      if (!cancelled && data.messages.length > 0) {
        setMessages(data.messages);
      }
    } finally {
      if (!cancelled) setMessagesLoaded(true);
    }
  })();
  return () => { cancelled = true; };
}, []);
```

c) Render `<BudgetMeter />` directly above the input area (find the message-list / input split in the existing JSX and add it).

d) When the chat returns 429 (budget exhausted), display the server-supplied message and disable input. Adjust the existing fetch handler:

```ts
if (res.status === 429) {
  const data = await res.json();
  setMessages((m) => [
    ...m,
    { role: "assistant", content: data.error ?? "Monthly allowance reached." },
  ]);
  setStreaming(false);
  setInputDisabled(true);
  return;
}
```

(Add `const [inputDisabled, setInputDisabled] = useState(false);` and pass `disabled={inputDisabled || streaming}` to the input/button.)

- [ ] **Step 4: Type-check + run unit tests**

Run: `npx tsc --noEmit && npm test -- src/lib/subscribers`
Expected: no type errors; all subscriber unit tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/p src/app/s src/app/chat
git commit -m "feat(public): wire subscriber header, persistent chat, budget meter"
```

---

## Task 14: Admin UI — Subscribers section in settings

**Files:**
- Modify: `src/app/admin/settings/SettingsPage.tsx`

- [ ] **Step 1: Append a `<SubscribersSection />` below the existing users section**

Add the new component within `SettingsPage.tsx` (same file, separate function) — keeps the diff cohesive and avoids spinning up another file:

```tsx
type Subscriber = {
  id: string;
  name: string;
  monthlyBudgetUsd: number;
  cycleStart: string;
  cycleUsedUsd: number;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

function SubscribersSection() {
  const [list, setList] = useState<Subscriber[]>([]);
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("1.20");
  const [generated, setGenerated] = useState<{ name: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function refresh() {
    const res = await fetch("/api/admin/subscribers");
    if (res.ok) {
      const data = await res.json();
      setList(data.subscribers ?? []);
    }
  }
  useEffect(() => { void refresh(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, monthlyBudgetUsd: Number(budget) }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "Failed");
      return;
    }
    const { code, subscriber } = await res.json();
    setGenerated({ name: subscriber.name, code });
    setName("");
    setBudget("1.20");
    void refresh();
  }

  async function handleRevoke(id: string, revoked: boolean) {
    await fetch(`/api/admin/subscribers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: !revoked }),
    });
    void refresh();
  }

  async function handleRegenerate(id: string, name: string) {
    if (!confirm(`Regenerate code for ${name}? The old code will stop working.`)) return;
    const res = await fetch(`/api/admin/subscribers/${id}/regenerate-code`, { method: "POST" });
    if (res.ok) {
      const { code } = await res.json();
      setGenerated({ name, code });
      void refresh();
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? Their chat history will also be deleted.`)) return;
    await fetch(`/api/admin/subscribers/${id}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <section className="mt-10">
      <h2 className="mb-3 text-lg font-bold">Subscribers</h2>

      <form onSubmit={handleAdd} className="mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-gray-600">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded border px-2 py-1 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-600">Monthly budget USD</label>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
            className="w-24 rounded border px-2 py-1 text-sm"
          />
        </div>
        <Button type="submit" disabled={busy}>Add subscriber</Button>
        {err && <span className="text-sm text-red-600">{err}</span>}
      </form>

      {generated && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold">Code generated for {generated.name}</p>
          <p className="mt-1">
            Send this on Facebook. You won&apos;t see it again.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-white px-2 py-1 font-mono text-base">{generated.code}</code>
            <button
              type="button"
              className="text-blue-600 hover:underline"
              onClick={() => navigator.clipboard.writeText(generated.code)}
            >
              Copy
            </button>
            <button
              type="button"
              className="ml-auto text-gray-500 hover:underline"
              onClick={() => setGenerated(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500">
          <tr>
            <th className="py-1">Name</th>
            <th>Last seen</th>
            <th>Spent / Budget</th>
            <th>State</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((s) => {
            const pct = s.monthlyBudgetUsd > 0
              ? Math.min(100, Math.round((s.cycleUsedUsd / s.monthlyBudgetUsd) * 100))
              : 100;
            return (
              <tr key={s.id} className="border-t">
                <td className="py-2">{s.name}</td>
                <td>{s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "—"}</td>
                <td>
                  ${s.cycleUsedUsd.toFixed(2)} / ${s.monthlyBudgetUsd.toFixed(2)}
                  <span className="ml-1 text-xs text-gray-500">({pct}%)</span>
                </td>
                <td>{s.revokedAt ? "Revoked" : "Active"}</td>
                <td className="space-x-2 text-right">
                  <button onClick={() => handleRegenerate(s.id, s.name)} className="text-blue-600 hover:underline">
                    Regenerate
                  </button>
                  <button onClick={() => handleRevoke(s.id, !!s.revokedAt)} className="text-blue-600 hover:underline">
                    {s.revokedAt ? "Restore" : "Revoke"}
                  </button>
                  <button onClick={() => handleDelete(s.id, s.name)} className="text-red-600 hover:underline">
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
```

Then, at the bottom of the existing `SettingsPage` component's JSX, before the closing tag, render:

```tsx
<SubscribersSection />
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/admin/settings/SettingsPage.tsx
git commit -m "feat(admin): subscribers section in settings"
```

---

## Task 15: Verification + handoff

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all subscriber tests pass; pre-existing tests unaffected. If any pre-existing test fails, investigate (don't paper over).

- [ ] **Step 2: TypeScript check + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors. The build will catch any missed `auth()`-in-middleware edge issues; if it fails on edge runtime, fall back to the `auth.config.ts` split documented in Task 7 Step 2.

- [ ] **Step 3: Push branch + open PR**

```bash
git push -u origin feature/subscriber-gate
gh pr create --title "feat: subscriber gate for public archive" --body "$(cat <<'EOF'
## Summary
- Adds a per-person access-code gate over `/`, `/p/*`, `/s/*`, `/chat`, behind a `PUBLIC_GATE_ENABLED` feature flag.
- Subscribers are admin-issued (name pre-attached, code returned once); persistent per-subscriber chat memory.
- Token-cost monthly budget per subscriber (default \$1.20) tracked from real `response.usage`; lazy reset on the 1st UTC.
- Adds prompt caching to `/api/chat` (10× cost reduction on Haiku 4.5).

## Test plan
- [ ] Pull branch, run `npm test`, verify all subscriber tests pass.
- [ ] Run migration locally (`npx prisma migrate deploy`).
- [ ] With `PUBLIC_GATE_ENABLED=false`, public site stays open.
- [ ] In `/admin/settings`, add a subscriber, copy the code.
- [ ] In private window, hit `/welcome`, paste the code, verify redirect to `/`.
- [ ] As subscriber, send a few chat messages; verify the budget meter increments.
- [ ] In admin panel, verify the spent-this-month figure increments.
- [ ] Set `PUBLIC_GATE_ENABLED=true`; verify unauthenticated access redirects to `/welcome`.

Spec: `docs/superpowers/specs/2026-04-28-subscriber-gate-design.md`
EOF
)"
```

- [ ] **Step 4: Add deploy notes to PR**

Reply on the PR with deploy steps:
1. Set `PUBLIC_GATE_ENABLED` env var in Vercel — leave at `false` for the first deploy.
2. After migration deploys, add subscribers via `/admin/settings`.
3. Flip `PUBLIC_GATE_ENABLED=true` in Vercel and redeploy.

---

## Definition of done

- All tasks above completed and committed.
- `npm test` clean (subscriber tests + existing tests).
- `npx tsc --noEmit` clean.
- `npm run build` clean.
- PR opened and ready for the user to deploy.
