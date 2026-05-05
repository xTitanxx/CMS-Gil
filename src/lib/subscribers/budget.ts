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

// Last anniversary on or before `now`, clamping the day to the month length
// (so e.g. a Jan-31 subscriber resets on Feb 28/29 in February).
export function startOfCurrentCycle(createdAt: Date, now: Date = new Date()): Date {
  const day = createdAt.getUTCDate();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = now.getUTCDate();

  const daysThis = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dayThis = Math.min(day, daysThis);

  if (today >= dayThis) return new Date(Date.UTC(y, m, dayThis));

  // anniversary is later this month → cycle started last month
  // (Date.UTC handles month = -1 by rolling into the prior year)
  const daysPrev = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const dayPrev = Math.min(day, daysPrev);
  return new Date(Date.UTC(y, m - 1, dayPrev));
}

export function startOfNextCycle(createdAt: Date, now: Date = new Date()): Date {
  const cur = startOfCurrentCycle(createdAt, now);
  const day = createdAt.getUTCDate();
  const y = cur.getUTCFullYear();
  const m = cur.getUTCMonth();
  const daysNext = new Date(Date.UTC(y, m + 2, 0)).getUTCDate();
  const dayNext = Math.min(day, daysNext);
  return new Date(Date.UTC(y, m + 1, dayNext));
}

export type BudgetCheck =
  | { allowed: true; usedUsd: number; budgetUsd: number; cycleResetsAt: Date }
  | { allowed: false; usedUsd: number; budgetUsd: number; cycleResetsAt: Date };

export async function checkBudgetAndLazyReset(subscriberId: string): Promise<BudgetCheck> {
  const sub = await prisma.subscriber.findUniqueOrThrow({
    where: { id: subscriberId },
    select: {
      createdAt: true,
      cycleStart: true,
      cycleUsedUsd: true,
      monthlyBudgetUsd: true,
    },
  });
  const now = new Date();
  const currentCycleStart = startOfCurrentCycle(sub.createdAt, now);
  const nextCycle = startOfNextCycle(sub.createdAt, now);

  let usedUsd = sub.cycleUsedUsd.toNumber();
  if (sub.cycleStart < currentCycleStart) {
    await prisma.subscriber.update({
      where: { id: subscriberId },
      data: { cycleStart: currentCycleStart, cycleUsedUsd: 0 },
    });
    usedUsd = 0;
  }
  const budgetUsd = sub.monthlyBudgetUsd.toNumber();
  return {
    allowed: usedUsd < budgetUsd,
    usedUsd,
    budgetUsd,
    cycleResetsAt: nextCycle,
  };
}

export async function recordUsage(params: {
  subscriberId: string;
  usage: Usage;
}): Promise<{ costUsd: number }> {
  const cost = computeHaikuCost(params.usage);
  // Sequential awaits instead of $transaction: pgbouncer transaction-pool
  // mode (the default Vercel-Supabase wiring) frequently fails to start a
  // prisma transaction in the default 2s window. The two writes here are
  // independent enough that worst-case partial failure (audit row inserted
  // but cycleUsedUsd not incremented) only loses tracking, not correctness.
  await prisma.subscriberUsage.create({
    data: {
      subscriberId: params.subscriberId,
      inputTokens: params.usage.input_tokens,
      cacheCreationInputTokens: params.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: params.usage.cache_read_input_tokens ?? 0,
      outputTokens: params.usage.output_tokens,
      costUsd: cost,
    },
  });
  await prisma.subscriber.update({
    where: { id: params.subscriberId },
    data: {
      cycleUsedUsd: { increment: cost },
      lastSeenAt: new Date(),
    },
  });
  return { costUsd: cost };
}

// Keep the Anthropic Usage type alias importable for callers
export type AnthropicUsage = NonNullable<
  Anthropic.Messages.Message["usage"]
>;
