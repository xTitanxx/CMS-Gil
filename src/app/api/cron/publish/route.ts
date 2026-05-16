// Publish cron — dispatch + reap only.
//
// 1) Reap orphaned PROCESSING rows. If a child publish lambda died mid-upload
//    (300s timeout, network blip, etc), the record is stuck in PROCESSING
//    forever — the only existing cleanup ran on the user's next manual
//    re-publish. Any PROCESSING row whose updatedAt is older than the reap
//    threshold gets transitioned to FAILED so the UI shows a terminal state.
//
// 2) Fan out due PENDING records to /api/internal/publish-record. Each child
//    runs in its own lambda invocation with its own 300s budget — fixes the
//    "5 platforms share a single 300s lambda" architectural bug that left
//    slower platforms in PROCESSING forever.

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/cron-auth";

export const maxDuration = 60;

const REAP_AFTER_MS = 10 * 60 * 1000; // 10 minutes

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const reapCutoff = new Date(now.getTime() - REAP_AFTER_MS);

  const { count: reaped } = await prisma.publishRecord.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: reapCutoff } },
    data: {
      status: "FAILED",
      errorMessage: "Recovered from stuck state (lambda timeout)",
      retryCount: { increment: 1 },
    },
  });

  const pendingRecords = await prisma.publishRecord.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
    },
    select: { id: true },
    take: 20,
    orderBy: { scheduledAt: "asc" },
  });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured", reaped },
      { status: 500 },
    );
  }

  const baseUrl = new URL("/api/internal/publish-record", req.url);

  after(async () => {
    await Promise.allSettled(
      pendingRecords.map((r) =>
        fetch(baseUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${cronSecret}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ recordId: r.id }),
        }).catch((err) =>
          console.error("cron dispatch failed", { recordId: r.id, err }),
        ),
      ),
    );
  });

  return NextResponse.json({
    reaped,
    dispatched: pendingRecords.length,
  });
}
