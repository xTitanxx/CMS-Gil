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
