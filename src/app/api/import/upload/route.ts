import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, ParsedPost } from "@/lib/facebook-parser";
import unzipper from "unzipper";

export const maxDuration = 300; // 5 min for Vercel Pro

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

  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: file.name,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  processUpload(job.id, userId, file).catch((err) => {
    console.error("Import error:", err);
    prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorLog: JSON.stringify([String(err)]),
        completedAt: new Date(),
      },
    });
  });

  return NextResponse.json({ jobId: job.id });
}

async function processUpload(jobId: string, userId: string, file: File): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (file.name.endsWith(".zip")) {
    await processZip(jobId, userId, buffer);
  } else if (file.name.endsWith(".json")) {
    await runImportJob({ jobId, userId, jsonContent: buffer.toString("utf-8") });
  } else {
    throw new Error("Unsupported file type. Upload a .zip or .json file.");
  }
}

async function processZip(jobId: string, userId: string, buffer: Buffer): Promise<void> {
  const directory = await unzipper.Open.buffer(buffer);

  // Collect all media files — keyed by both full path AND filename alone
  // so we can match regardless of folder structure
  const mediaByPath = new Map<string, Buffer>();
  const mediaByFilename = new Map<string, Buffer>();

  // Collect all JSON file contents
  const jsonFiles: string[] = [];

  for (const entry of directory.files) {
    if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

    const entryBuffer = await entry.buffer();
    const filename = entry.path.split("/").pop() ?? "";

    if (entry.path.match(/\.json$/i)) {
      jsonFiles.push(entryBuffer.toString("utf-8"));
    } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
      mediaByPath.set(entry.path, entryBuffer);
      mediaByPath.set(entry.path.replace(/^\/+/, ""), entryBuffer);
      if (filename) mediaByFilename.set(filename, entryBuffer);
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
      // Skip unparseable JSON files (e.g. metadata files)
    }
  }

  if (allPosts.length === 0) {
    throw new Error("No posts found in the exported JSON files.");
  }

  // Build a unified media map: try full path first, fall back to filename
  const mediaFiles = new Map<string, Buffer>();
  for (const post of allPosts) {
    for (const uri of post.mediaUris) {
      const normalized = uri.replace(/^\/+/, "");
      const filename = uri.split("/").pop() ?? "";

      const buf =
        mediaByPath.get(normalized) ??
        mediaByPath.get(uri) ??
        mediaByFilename.get(filename);

      if (buf) {
        mediaFiles.set(normalized, buf);
        mediaFiles.set(uri, buf);
      }
    }
  }

  await runImportJob({ jobId, userId, parsedPosts: allPosts, mediaFiles });
}
