import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { google, drive_v3 } from "googleapis";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, dedupeParsedPosts, ParsedPost } from "@/lib/facebook-parser";
import { buildGoogleOAuthClient, getGoogleIntegration } from "@/lib/google-integration";

export const maxDuration = 300;

// Cap how many imports run in parallel so deeply-nested daily exports don't
// exhaust the Prisma connection pool. FB daily folders typically contain a few
// importable JSONs each, so this is plenty even for 4+ batches.
const IMPORT_CONCURRENCY = 3;

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

  const wantDebug = new URL(req.url).searchParams.get("debug") === "1";
  const debug: DriveDebugCounts | undefined = wantDebug
    ? { folders: 0, files: 0, importable: 0, byParent: {} }
    : undefined;

  const jobs = await syncDriveFolder(userId, driveSync.folderId, debug);
  await prisma.driveSync.update({
    where: { userId },
    data: { lastSyncedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    jobsCreated: jobs.length,
    ...(debug ? { debug, folderId: driveSync.folderId } : {}),
  });
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
interface DriveDebugCounts {
  folders: number;
  files: number;
  importable: number;
  byParent: Record<string, { files: number; importable: number; sampleNames: string[] }>;
}

async function collectDriveFiles(
  drive: drive_v3.Drive,
  folderId: string,
  fileIndex: Map<string, string>,
  folderName = "",
  debug?: DriveDebugCounts,
): Promise<ImportableFile[]> {
  const importable: ImportableFile[] = [];
  let pageToken: string | undefined;

  do {
    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "nextPageToken, files(id, name, mimeType, modifiedTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    pageToken = res.data.nextPageToken ?? undefined;

    for (const file of res.data.files ?? []) {
      if (!file.id || !file.name) continue;

      if (file.mimeType === "application/vnd.google-apps.folder") {
        if (debug) debug.folders += 1;
        const sub = await collectDriveFiles(drive, file.id, fileIndex, file.name, debug);
        importable.push(...sub);
      } else {
        // Index every non-folder file by name so getMedia can find it
        fileIndex.set(file.name, file.id);
        if (debug) {
          debug.files += 1;
          const bucket = (debug.byParent[folderName || "<root>"] ??= {
            files: 0,
            importable: 0,
            sampleNames: [],
          });
          bucket.files += 1;
          if (bucket.sampleNames.length < 5) bucket.sampleNames.push(file.name);
        }
        if (isImportableJson(file.name, folderName)) {
          if (debug) {
            debug.importable += 1;
            const bucket = debug.byParent[folderName || "<root>"];
            if (bucket) bucket.importable += 1;
          }
          importable.push({ ...file, parentFolderName: folderName });
        }
      }
    }
  } while (pageToken);

  return importable;
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number) {
  const queue = tasks.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const next = queue.shift();
      if (!next) return;
      try {
        await next();
      } catch (err) {
        console.error("drive sync task failed:", err);
      }
    }
  });
  await Promise.all(workers);
}

async function downloadDriveFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

async function processDriveZip(
  jobId: string,
  userId: string,
  buffer: Buffer
): Promise<void> {
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
    jobId,
    userId,
    parsedPosts: dedupedPosts,
    getMedia,
    source: "GOOGLE_DRIVE",
  });
}

export async function syncDriveFolder(
  userId: string,
  folderId: string,
  debug?: DriveDebugCounts,
) {
  const integration = await getGoogleIntegration(userId);
  if (!integration) {
    console.warn("[drive-sync] no Google integration for", userId);
    return [];
  }

  const oauth2Client = buildGoogleOAuthClient(userId, integration);
  const drive = google.drive({ version: "v3", auth: oauth2Client });

  // Recursively traverse the folder tree, indexing all files by name
  const fileIndex = new Map<string, string>(); // filename → Drive file ID
  const files = await collectDriveFiles(drive, folderId, fileIndex, "", debug);
  console.log("[drive-sync] traversal", {
    userId,
    folderId,
    indexed: fileIndex.size,
    importable: files.length,
  });

  const createdJobs: string[] = [];
  const tasks: Array<() => Promise<void>> = [];

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

    // Reserve a job row up front so the UI sees the queue immediately. Heavy
    // work (download + parse + runImportJob) is deferred and runs in after()
    // with bounded concurrency below.
    const job = await prisma.importJob.create({
      data: {
        userId,
        filename: file.name,
        sourceFileId: file.id,
        source: "GOOGLE_DRIVE",
        status: "PENDING",
      },
    });
    createdJobs.push(job.id);

    const fileId = file.id;
    const fileName = file.name;
    tasks.push(async () => {
      try {
        const buffer = await downloadDriveFile(drive, fileId);

        if (fileName.endsWith(".json")) {
          // Lazy media loader: resolves URIs by filename against the Drive index
          const getMedia = async (uri: string): Promise<Buffer | null> => {
            const mediaName = uri.split("/").pop();
            if (!mediaName) return null;
            const mediaFileId = fileIndex.get(mediaName);
            if (!mediaFileId) return null;
            try {
              return await downloadDriveFile(drive, mediaFileId);
            } catch {
              return null;
            }
          };

          await runImportJob({
            jobId: job.id,
            userId,
            jsonContent: buffer.toString("utf-8"),
            getMedia,
            source: "GOOGLE_DRIVE",
          });
        } else if (fileName.endsWith(".zip")) {
          await processDriveZip(job.id, userId, buffer);
        }
      } catch (err) {
        console.error(`drive sync: ${fileName} failed`, err);
        await prisma.importJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            errorLog: String(err).slice(0, 2000),
            completedAt: new Date(),
          },
        });
      }
    });
  }

  if (tasks.length > 0) {
    // after() keeps the lambda alive past the response so the imports finish.
    after(async () => {
      await runWithConcurrency(tasks, IMPORT_CONCURRENCY);
    });
  }

  return createdJobs;
}
