import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  decide,
  finalize,
  deleteBatch,
  getReviewBatch,
} from "@/lib/trash-review";

async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dir: string }> },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;
  const { dir } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    action?: "decide" | "finalize";
    decisions?: Array<{ dropId: string; decision: "approve" | "reject" | "pending" }>;
  };

  if (body.action === "finalize") {
    const res = await finalize(dir);
    return NextResponse.json(res);
  }

  if (body.action === "decide" && Array.isArray(body.decisions)) {
    const updated = await decide(dir, body.decisions);
    if (!updated) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }
    return NextResponse.json({
      groupCount: updated.groupCount,
      pendingDropCount: updated.pendingDropCount,
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ dir: string }> },
) {
  const unauth = await requireAuth();
  if (unauth) return unauth;
  const { dir } = await ctx.params;
  const existing = await getReviewBatch(dir);
  if (!existing) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }
  const ok = await deleteBatch(dir);
  return NextResponse.json({ ok });
}
