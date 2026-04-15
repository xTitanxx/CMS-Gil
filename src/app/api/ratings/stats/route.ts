import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const userId = session.user.id;

  const total = await prisma.post.count({ where: { userId, readiness: "READY" } });
  const rated = await prisma.postRating.count({ where: { post: { userId } } });
  const byStarRows = await prisma.postRating.groupBy({
    by: ["stars"], where: { post: { userId } }, _count: true,
  });
  const byStar: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of byStarRows) byStar[r.stars] = r._count;
  return NextResponse.json({ total, rated, byStar });
}
