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
