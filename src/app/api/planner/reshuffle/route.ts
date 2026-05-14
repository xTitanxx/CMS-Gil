import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeShuffledOrderForUser } from "@/lib/planner/reshuffle";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const shuffled = await writeShuffledOrderForUser(session.user.id);
  return NextResponse.json({ shuffled, generatedAt: new Date().toISOString() });
}
