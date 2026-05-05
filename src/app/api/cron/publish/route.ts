import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Platform } from "@prisma/client";
import { publishNow } from "@/app/api/posts/[id]/publish/route";
import { isAuthorizedCron } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Find all pending records whose scheduled time has passed
  const pendingRecords = await prisma.publishRecord.findMany({
    where: {
      status: "PENDING",
      scheduledAt: { lte: now },
    },
    include: {
      post: {
        include: {
          media: {
            // Need audioTrack here so publishNow can mux silent videos that
            // have music attached, before handing the URL to the platform.
            include: { audioTrack: { select: { storageKey: true } } },
          },
        },
      },
    },
    take: 20, // process max 20 per cron tick
  });

  const results = [];

  for (const record of pendingRecords) {
    try {
      await publishNow(
        record.id,
        record.post.userId,
        record.post,
        record.platform as Platform
      );
      results.push({ id: record.id, status: "published" });
    } catch (err) {
      results.push({ id: record.id, status: "failed", error: String(err) });
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
