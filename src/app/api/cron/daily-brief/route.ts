import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recommend } from "@/lib/assistant/recommend";
import { startOfDay } from "date-fns";
import { isAuthorizedCron } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  const today = startOfDay(new Date());
  let written = 0;

  for (const u of users) {
    const recs = await recommend({ userId: u.id, when: new Date(), limit: 3 });
    if (recs.length === 0) continue;
    await prisma.dailyBrief.upsert({
      where: { userId_date: { userId: u.id, date: today } },
      update: { payload: recs as unknown as object },
      create: { userId: u.id, date: today, payload: recs as unknown as object },
    });
    written++;
  }

  return NextResponse.json({ ok: true, written });
}
