import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkBudgetAndLazyReset } from "@/lib/subscribers/budget";

export async function GET() {
  const session = await auth();
  if (!session) return Response.json({ error: "Sign in required." }, { status: 401 });

  if (session.user.role !== "subscriber" || !session.user.subscriberId) {
    // Admin: no budget cap, but we still surface this calendar month's API
    // spend across /chat + /admin/assistant so the admin sees what the chat
    // is costing them. AssistantUsage is the union log for both surfaces.
    const adminId = session.user.id;
    const monthStart = startOfCalendarMonth(new Date());
    const totalUsd = adminId
      ? await sumAssistantUsage(adminId, monthStart)
      : 0;
    return Response.json({
      role: "admin",
      usedUsd: totalUsd,
      budgetUsd: 0,
      percentUsed: 0,
      cycleResetsAt: null,
      unlimited: true,
      monthSpentUsd: totalUsd,
      monthLabel: monthStart.toLocaleString("en-US", { month: "long", year: "numeric" }),
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

function startOfCalendarMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function sumAssistantUsage(userId: string, since: Date): Promise<number> {
  const agg = await prisma.assistantUsage.aggregate({
    where: { userId, createdAt: { gte: since } },
    _sum: { costUsd: true },
  });
  return agg._sum.costUsd ? Number(agg._sum.costUsd) : 0;
}
