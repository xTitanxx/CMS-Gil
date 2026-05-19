import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { google, drive_v3 } from "googleapis";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, dedupeParsedPosts, ParsedPost } from "@/lib/facebook-parser";
import { buildGoogleOAuthClient, getGoogleIntegration } from "@/lib/google-integration";

export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const driveSync = await prisma.driveSync.findUnique({
    where: { userId: session.user.id },
    select: { folderId: true, folderName: true, lastSyncedAt: true, enabled: true },
  });
  return NextResponse.json({ driveSync: driveSync ?? null });
}

export async function DELETE(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { count } = await prisma.importJob.deleteMany({
    where: { userId: session.user.id, source: "GOOGLE_DRIVE" },
  });
  return NextResponse.json({ ok: true, deleted: count });
}

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

type ImportableFile = drive_v3.Schema$File & { parentFolderName: string };

// Returns true for JSON files that contain original Facebook post content.
// Skips edit history, pinned reels, memory metadata, and other noise files.
function isImportableJson(filename: string, parentFolderName: string): boolean {
  if (filename.endsWith(".zip")) return true;
  if (!filename.endsWith(".json")) return false;

  // Album JSONs live inside a folder named "album"
  if (parentFolderName === "album") return true;

  // Recognised top-level content files
  if (/^your_posts.*\.json$/i.test(filename)) return true;
  if (/^your_videos\.json$/i.test(filename)) return true;

  // Everything else (edits, pinned reels, memories, reactions, comments…) — skip
  return false;
}

// Recursively collect importable files from the folder tree.
// Populates fileIndex (filename → fileId) for lazy media lookups.
async function collectDriveFiles(
  drive: drive_v3.Drive,
  folderId: string,
  fileIndex: Map<string, string>,
  folderName = ""
): Promise<ImportableFile[]> {
  const importable: ImportableFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 1000,
      pageToken,
    });

    pageToken = res.data.nextPageToken ?? undefined;

    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name) continue;

      if (file.mimeType === "application/vnd.google-apps.folder") {
        const sub = await collectDriveFiles(drive, file.id, fileIndex, file.name);
        importable.push(...sub);
      } else {
        // Index every non-folder file by name so getMedia can find it
        fileIndex.set(file.name, file.id);
        if (isImportableJson(file.name, folderName)) {
          importable.push({ ...file, parentFolderName: folderName });
        }
      }
    }
  } while (pageToken);

  return importable;
}

export async function syncDriveFolder(userId: string, folderId: string) {
  const integration = await getGoogleIntegration(userId);
  if (!integration) return [];

  const oauth2Client = buildGoogleOAuthClient(userId, integration);
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // Recursively traverse the folder tree, indexing all files by name
  const fileIndex = new Map<string, string>(); // filename → Drive file ID
  const files = await collectDriveFiles(drive, folderId, fileIndex);

  const createdJobs: string[] = [];

  for (const file of files) {
    if (!file.id || !file.name) continue;

    // Dedup by Drive file ID. FB exports always name their JSON the same
    // (`your_posts_1.json`, `your_videos.json`, etc.), so matching on filename
    // silently swallows every daily folder after the first one. Legacy rows
    // (sourceFileId = null) are ignored on purpose — Post-level dedup via
    // `(userId, sourceId)` in import-worker.ts still prevents duplicate Posts.
    const existingJob = await prisma.importJob.findFirst({
      where: {
        userId,
        source: "GOOGLE_DRIVE",
        sourceFileId: file.id,
        status: { in: ["COMPLETED", "PROCESSING"] },
      },
    });
    if (existingJob) continue;

    // Download file content
    const fileRes = await drive.files.get(
      { fileId: file.id, alt: "media" },
      { responseType: "arraybuffer" }
    );
    const buffer = Buffer.from(fileRes.data as ArrayBuffer);

    const job = await prisma.importJob.create({
      data: {
        userId,
        filename: file.name,
        sourceFileId: file.id,
        source: "GOOGLE_DRIVE",
        status: "PENDING",
      },
    });

    if (file.name.endsWith(".json")) {
      const jsonContent = buffer.toString("utf-8");

      // Lazy media loader: resolves URIs by filename against the Drive index
      const getMedia = async (uri: string): Promise<Buffer | null> => {
        const filename = uri.split("/").pop();
        if (!filename) return null;
        const mediaFileId = fileIndex.get(filename);
        if (!mediaFileId) return null;
        try {
          const mediaRes = await drive.files.get(
            { fileId: mediaFileId, alt: "media" },
            { responseType: "arraybuffer" }
          );
          return Buffer.from(mediaRes.data as ArrayBuffer);
        } catch {
          return null;
        }
      };

      runImportJob({
        jobId: job.id,
        userId,
        jsonContent,
        getMedia,
        source: "GOOGLE_DRIVE",
      }).catch(console.error);
    } else if (file.name.endsWith(".zip")) {
      (async () => {
        const unzipper = await import("unzipper");
        const dir = await unzipper.Open.buffer(buffer);

        type ZipEntry = (typeof dir.files)[number];
        const mediaEntries = new Map<string, ZipEntry>();
        const jsonFiles: string[] = [];

        for (const entry of dir.files) {
          if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;
          const entryFilename = entry.path.split("/").pop() ?? "";

          if (entry.path.match(/\.json$/i)) {
            const entryBuffer = await entry.buffer();
            jsonFiles.push(entryBuffer.toString("utf-8"));
          } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
            mediaEntries.set(entry.path, entry);
            mediaEntries.set(entry.path.replace(/^\/+/, ""), entry);
            if (entryFilename && !mediaEntries.has(entryFilename)) {
              mediaEntries.set(entryFilename, entry);
            }
          }
        }

        if (jsonFiles.length === 0) return;

        const allPosts: ParsedPost[] = [];
        for (const jsonContent of jsonFiles) {
          try {
            const raw = JSON.parse(jsonContent);
            allPosts.push(...parseFacebookFile(raw));
          } catch {
            // Skip unparseable files (metadata, etc.)
          }
        }

        // Prefer entries from your_posts_*.json (post.timestamp) over album/video
        // files (media creation_timestamp) when the same photo/video appears in both.
        const dedupedPosts = dedupeParsedPosts(allPosts);

        if (dedupedPosts.length === 0) return;

        const getMedia = async (uri: string): Promise<Buffer | null> => {
          const normalized = uri.replace(/^\/+/, "");
          const uriFilename = uri.split("/").pop() ?? "";
          const entry =
            mediaEntries.get(normalized) ??
            mediaEntries.get(uri) ??
            mediaEntries.get(uriFilename);
          if (!entry) return null;
          return entry.buffer();
        };

        await runImportJob({
          jobId: job.id,
          userId,
          parsedPosts: dedupedPosts,
          getMedia,
          source: "GOOGLE_DRIVE",
        });
      })().catch(console.error);
    }

    createdJobs.push(job.id);
  }

  return createdJobs;
}
