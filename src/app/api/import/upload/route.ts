import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, ParsedPost } from "@/lib/facebook-parser";
import unzipper from "unzipper";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Read buffer before response — this is just moving bytes already in memory, fast
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;

  const job = await prisma.importJob.create({
    data: { userId, filename, source: "UPLOAD", status: "PENDING" },
  });

  // after() keeps the serverless function alive after the response is sent
  after(async () => {
    try {
      await processUpload(job.id, userId, buffer, filename);
    } catch (err) {
      console.error("Import error:", err);
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorLog: JSON.stringify([String(err)]),
          completedAt: new Date(),
        },
      });
    }
  });

  return NextResponse.json({ jobId: job.id });
}

async function processUpload(
  jobId: string,
  userId: string,
  buffer: Buffer,
  filename: string
): Promise<void> {
  if (filename.endsWith(".zip")) {
    await processZip(jobId, userId, buffer);
  } else if (filename.endsWith(".json")) {
    await runImportJob({ jobId, userId, jsonContent: buffer.toString("utf-8") });
  } else {
    throw new Error("Unsupported file type. Upload a .zip or .json file.");
  }
}

async function processZip(jobId: string, userId: string, buffer: Buffer): Promise<void> {
  const directory = await unzipper.Open.buffer(buffer);

  // Store entry references (NOT buffers) — we read each file only when needed
  // This prevents loading all media into memory at once
  type ZipEntry = (typeof directory.files)[number];
  const mediaEntries = new Map<string, ZipEntry>();

  const jsonFiles: string[] = [];

  for (const entry of directory.files) {
    if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

    const filename = entry.path.split("/").pop() ?? "";

    if (entry.path.match(/\.json$/i)) {
      // JSON files are small — read immediately
      const entryBuffer = await entry.buffer();
      jsonFiles.push(entryBuffer.toString("utf-8"));
    } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
      // Store entry references, not buffers
      mediaEntries.set(entry.path, entry);
      mediaEntries.set(entry.path.replace(/^\/+/, ""), entry);
      if (filename) {
        // filename-only key as fallback (in case JSON uri paths differ from ZIP paths)
        if (!mediaEntries.has(filename)) mediaEntries.set(filename, entry);
      }
    }
  }

  if (jsonFiles.length === 0) {
    throw new Error("No JSON files found in ZIP. Make sure you're uploading a Facebook data export.");
  }

  // Parse all JSON files and merge posts
  const allPosts: ParsedPost[] = [];
  for (const jsonContent of jsonFiles) {
    try {
      const raw = JSON.parse(jsonContent);
      const posts = parseFacebookFile(raw);
      allPosts.push(...posts);
    } catch {
      // Skip unparseable JSON files (metadata files, etc.)
    }
  }

  if (allPosts.length === 0) {
    throw new Error("No posts found in the exported JSON files.");
  }

  // Lazy media loader — reads ONE file at a time from the ZIP buffer
  const getMedia = async (uri: string): Promise<Buffer | null> => {
    const normalized = uri.replace(/^\/+/, "");
    const filename = uri.split("/").pop() ?? "";

    const entry =
      mediaEntries.get(normalized) ??
      mediaEntries.get(uri) ??
      mediaEntries.get(filename);

    if (!entry) return null;
    return entry.buffer();
  };

  await runImportJob({ jobId, userId, parsedPosts: allPosts, getMedia });
}
