import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function startOfMonthUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = session.user.id;
  const now = new Date();

  const todayStart = startOfDayUtc(now);
  const monthStart = startOfMonthUtc(now);
  const sevenDaysAgo = new Date(todayStart.getTime() - 6 * 24 * 3600 * 1000);

  const [todayAgg, last7Agg, monthAgg, allTimeAgg] = await Promise.all([
    prisma.assistantUsage.aggregate({
      where: { userId, createdAt: { gte: todayStart } },
      _sum: { costUsd: true, inputTokens: true, outputTokens: true, cacheCreateTokens: true, cacheReadTokens: true },
    }),
    prisma.assistantUsage.aggregate({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      _sum: { costUsd: true },
    }),
    prisma.assistantUsage.aggregate({
      where: { userId, createdAt: { gte: monthStart } },
      _sum: { costUsd: true },
    }),
    prisma.assistantUsage.aggregate({
      where: { userId },
      _sum: { costUsd: true },
    }),
  ]);

  const num = (v: unknown): number => (v == null ? 0 : Number(v));

  return NextResponse.json({
    today: num(todayAgg._sum.costUsd),
    last7Days: num(last7Agg._sum.costUsd),
    thisMonth: num(monthAgg._sum.costUsd),
    allTime: num(allTimeAgg._sum.costUsd),
    todayTokens: {
      input: todayAgg._sum.inputTokens ?? 0,
      output: todayAgg._sum.outputTokens ?? 0,
      cacheWrite: todayAgg._sum.cacheCreateTokens ?? 0,
      cacheRead: todayAgg._sum.cacheReadTokens ?? 0,
    },
  });
}
