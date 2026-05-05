import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { startOfDay } from "date-fns";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const brief = await prisma.dailyBrief.findUnique({
    where: { userId_date: { userId: session.user.id, date: startOfDay(new Date()) } },
  });
  return NextResponse.json({ brief });
}
