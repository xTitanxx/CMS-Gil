// Internal fan-out endpoint. Each PublishRecord runs here in its own lambda
// invocation so platforms don't share a 300s wall-clock budget. Authenticated
// with the same Bearer CRON_SECRET the cron uses — only reachable from the
// publish/cron dispatchers and from us-with-curl for debugging.
//
// The handler returns 202 as soon as the work is scheduled via after(); the
// platform upload runs in the background inside this child lambda's own 300s
// budget. That keeps the parent's fan-out loop fast (~ms per dispatch) while
// every platform gets its full window.

import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { publishNow } from "@/app/api/posts/[id]/publish/route";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { recordId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const recordId = body.recordId;
  if (!recordId || typeof recordId !== "string") {
    return NextResponse.json({ error: "recordId required" }, { status: 400 });
  }

  const record = await prisma.publishRecord.findUnique({
    where: { id: recordId },
    include: {
      post: {
        include: {
          media: {
            include: { audioTrack: { select: { storageKey: true } } },
          },
        },
      },
    },
  });

  if (!record) {
    return NextResponse.json({ error: "Record not found" }, { status: 404 });
  }

  // Only PENDING records should be dispatched. PROCESSING means another
  // invocation is already handling it; PUBLISHED/FAILED/CANCELLED are terminal.
  if (record.status !== "PENDING") {
    return NextResponse.json(
      { skipped: true, status: record.status },
      { status: 200 },
    );
  }

  const post = record.post;
  const platform = record.platform as Platform;

  after(async () => {
    try {
      await publishNow(record.id, post.userId, post, platform);
    } catch (err) {
      console.error("internal publishNow failed", { recordId, platform, err });
    }
  });

  return NextResponse.json({ dispatched: true, recordId }, { status: 202 });
}
