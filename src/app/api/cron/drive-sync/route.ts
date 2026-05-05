import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncDriveFolder } from "@/app/api/drive/sync/route";
import { isAuthorizedCron } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all enabled DriveSync configs
  const syncConfigs = await prisma.driveSync.findMany({
    where: { enabled: true },
  });

  const results = [];

  for (const config of syncConfigs) {
    try {
      const jobs = await syncDriveFolder(config.userId, config.folderId);
      await prisma.driveSync.update({
        where: { id: config.id },
        data: { lastSyncedAt: new Date() },
      });
      results.push({ userId: config.userId, jobsCreated: jobs.length });
    } catch (err) {
      results.push({ userId: config.userId, error: String(err) });
    }
  }

  return NextResponse.json({ synced: results.length, results });
}
