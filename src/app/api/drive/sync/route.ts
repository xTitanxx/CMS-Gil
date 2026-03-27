import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { google } from "googleapis";
import { runImportJob } from "@/lib/import-worker";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json().catch(() => ({}));

  // Allow saving a new folder config
  if (body.folderId && body.folderName) {
    await prisma.driveSync.upsert({
      where: { userId },
      create: { userId, folderId: body.folderId, folderName: body.folderName },
      update: { folderId: body.folderId, folderName: body.folderName, enabled: true },
    });
    return NextResponse.json({ ok: true, message: "Drive folder saved" });
  }

  // Trigger a manual sync
  const driveSync = await prisma.driveSync.findUnique({ where: { userId } });
  if (!driveSync?.enabled) {
    return NextResponse.json({ error: "No Drive folder configured" }, { status: 400 });
  }

  const jobs = await syncDriveFolder(userId, driveSync.folderId);
  await prisma.driveSync.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return NextResponse.json({ ok: true, jobsCreated: jobs.length });
}

export async function syncDriveFolder(userId: string, folderId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { access_token: true, refresh_token: true },
  });
  if (!account?.access_token) return [];

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token ?? undefined,
  });

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // List JSON and ZIP files in the folder
  const res = await drive.files.list({
    q: `'${folderId}' in parents and (name contains '.json' or name contains '.zip') and trashed=false`,
    fields: "files(id, name, modifiedTime, size)",
    orderBy: "modifiedTime desc",
    pageSize: 50,
  });

  const files = res.data.files ?? [];
  const createdJobs: string[] = [];

  for (const file of files) {
    if (!file.id || !file.name) continue;

    // Skip if we've already imported this file (by name + modifiedTime as proxy)
    const existingJob = await prisma.importJob.findFirst({
      where: {
        userId,
        filename: file.name,
        source: "GOOGLE_DRIVE",
        status: { in: ["COMPLETED", "PROCESSING"] },
      },
    });
    if (existingJob) continue;

    // Download file
    const fileRes = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(fileRes.data as ArrayBuffer);

    const job = await prisma.importJob.create({
      data: {
        userId,
        filename: file.name,
        source: "GOOGLE_DRIVE",
        status: "PENDING",
      },
    });

    // Run import async
    const jsonContent = file.name.endsWith(".json")
      ? buffer.toString("utf-8")
      : null;

    if (jsonContent) {
      runImportJob({ jobId: job.id, userId, jsonContent, source: "GOOGLE_DRIVE" }).catch(
        console.error
      );
    } else if (file.name.endsWith(".zip")) {
      // For ZIP files, import via the same zip logic
      import("@/app/api/import/upload/route").then(async () => {
        const unzipper = await import("unzipper");
        const dir = await unzipper.Open.buffer(buffer);
        const mediaFiles = new Map<string, Buffer>();
        let jsonStr: string | null = null;

        for (const entry of dir.files) {
          const entryBuffer = await entry.buffer();
          if (entry.path.match(/your_posts.*\.json$/i)) {
            jsonStr = entryBuffer.toString("utf-8");
          } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|webm)$/i)) {
            mediaFiles.set(entry.path, entryBuffer);
          }
        }

        if (jsonStr) {
          await runImportJob({
            jobId: job.id,
            userId,
            jsonContent: jsonStr,
            mediaFiles,
            source: "GOOGLE_DRIVE",
          });
        }
      }).catch(console.error);
    }

    createdJobs.push(job.id);
  }

  return createdJobs;
}
