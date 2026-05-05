import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { reconcileEngagementCounts } from "@/lib/engagement/reconcile";

export async function POST() {
  const session = await auth();
  if (session?.user?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const result = await reconcileEngagementCounts();
  return NextResponse.json(result);
}
