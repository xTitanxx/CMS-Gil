import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const REASONS = ["silent-video","unchecked-audio","empty","share-only","broken-media","dont-post"];

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const userId = session.user.id;

  const total = await prisma.post.count({ where: { userId, readiness: "NOT_READY" } });
  const byReason: Record<string, number> = {};
  for (const r of REASONS) {
    byReason[r] = await prisma.post.count({
      where: { userId, readiness: "NOT_READY", notReadyReasons: { has: r } },
    });
  }
  return NextResponse.json({ total, byReason });
}
