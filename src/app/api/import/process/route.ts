import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, dedupeParsedPosts, ParsedPost } from "@/lib/facebook-parser";
import { del } from "@vercel/blob";
import unzipper from "unzipper";
import { readdir } from "fs/promises";
import { join } from "path";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const contentType = req.headers.get("content-type") ?? "";
  let blobUrls: string[] = [];
  let localPath = "";

  if (contentType.includes("application/json")) {
    const body = await req.json();
    if (body.localPath) {
      localPath = body.localPath;
    } else if (Array.isArray(body.blobUrls) && body.blobUrls.length > 0) {
      blobUrls = body.blobUrls;
    } else {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: localPath ? `Local: ${localPath.split("/").pop()}` : `${blobUrls.length} ZIP files`,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  after(async () => {
    try {
      if (localPath) {
        await processLocalFolder(job.id, userId, localPath);
      } else {
        await processMultiZipFromBlob(job.id, userId, blobUrls);
      }
    } catch (err) {
      console.error("Multi-ZIP import error:", err);
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorLog: JSON.stringify([String(err)]),
          completedAt: new Date(),
        },
      });
    } finally {
      for (const url of blobUrls) {
        del(url).catch(() => {});
      }
    }
  });

  return NextResponse.json({ jobId: job.id });
}

type ZipEntry = unzipper.File;

interface MediaRef { entry: ZipEntry }

function indexZipEntries(
  directory: unzipper.CentralDirectory,
  mediaEntries: Map<string, MediaRef>,
) {
  for (const entry of directory.files) {
    if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

    const filename = entry.path.split("/").pop() ?? "";

    if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
      const normalized = entry.path.replace(/^\/+/, "");
      const ref = { entry };
      mediaEntries.set(entry.path, ref);
      mediaEntries.set(normalized, ref);
      // Strip the top-level facebook folder prefix to match JSON URI format
      const parts = normalized.split("/");
      if (parts.length > 1) {
        const withoutPrefix = parts.slice(1).join("/");
        if (!mediaEntries.has(withoutPrefix)) {
          mediaEntries.set(withoutPrefix, ref);
        }
      }
      if (filename && !mediaEntries.has(filename)) {
        mediaEntries.set(filename, ref);
      }
    }
  }
}

async function readJsonEntries(directory: unzipper.CentralDirectory): Promise<string[]> {
  const results: string[] = [];
  for (const entry of directory.files) {
    if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;
    if (entry.path.match(/\.json$/i)) {
      const buf = await entry.buffer();
      results.push(buf.toString("utf-8"));
    }
  }
  return results;
}

// Process ZIPs from a local folder — uses unzipper.Open.file() which reads
// only the central directory (~KB), not the full file (~GB). Individual media
// files are extracted on demand during import.
async function processLocalFolder(
  jobId: string,
  userId: string,
  folderPath: string,
): Promise<void> {
  const entries = await readdir(folderPath);
  const zipFiles = entries
    .filter((f) => f.match(/\.zip$/i))
    .map((f) => join(folderPath, f))
    .sort();

  if (zipFiles.length === 0) {
    throw new Error("No .zip files found in the specified folder.");
  }

  const mediaEntries = new Map<string, MediaRef>();
  const jsonContents: string[] = [];
  // Keep directory refs alive so entries stay readable
  const directories: unzipper.CentralDirectory[] = [];

  for (const zipPath of zipFiles) {
    // Open.file reads only the central directory from disk, not the whole ZIP
    const directory = await unzipper.Open.file(zipPath);
    directories.push(directory);
    indexZipEntries(directory, mediaEntries);
    const jsons = await readJsonEntries(directory);
    jsonContents.push(...jsons);
  }

  if (jsonContents.length === 0) {
    throw new Error("No JSON files found in the ZIPs. Make sure the folder contains Facebook data exports.");
  }

  const allPosts: ParsedPost[] = [];
  for (const jsonContent of jsonContents) {
    try {
      const raw = JSON.parse(jsonContent);
      const posts = parseFacebookFile(raw);
      allPosts.push(...posts);
    } catch {
      // Skip unparseable JSON files
    }
  }

  // Prefer entries from your_posts_*.json (post.timestamp) over album/video
  // files (media creation_timestamp) when the same photo/video appears in both.
  const dedupedPosts = dedupeParsedPosts(allPosts);

  if (dedupedPosts.length === 0) {
    throw new Error("No posts found in the exported JSON files.");
  }

  // Lazy media loader — extracts one file at a time from the ZIP on disk
  const getMedia = async (uri: string): Promise<Buffer | null> => {
    const normalized = uri.replace(/^\/+/, "");
    const filename = uri.split("/").pop() ?? "";
    const ref =
      mediaEntries.get(normalized) ??
      mediaEntries.get(uri) ??
      mediaEntries.get(filename);
    if (!ref) return null;
    return ref.entry.buffer();
  };

  await runImportJob({ jobId, userId, parsedPosts: dedupedPosts, getMedia });
}

async function processMultiZipFromBlob(
  jobId: string,
  userId: string,
  blobUrls: string[],
): Promise<void> {
  const mediaEntries = new Map<string, MediaRef>();
  const jsonContents: string[] = [];
  const directories: unzipper.CentralDirectory[] = [];

  for (const blobUrl of blobUrls) {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ZIP from Blob: ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const directory = await unzipper.Open.buffer(buffer);
    directories.push(directory);
    indexZipEntries(directory, mediaEntries);
    const jsons = await readJsonEntries(directory);
    jsonContents.push(...jsons);
  }

  if (jsonContents.length === 0) {
    throw new Error("No JSON files found in the uploaded ZIPs.");
  }

  const allPosts: ParsedPost[] = [];
  for (const jsonContent of jsonContents) {
    try {
      const raw = JSON.parse(jsonContent);
      const posts = parseFacebookFile(raw);
      allPosts.push(...posts);
    } catch {
      // Skip unparseable JSON files
    }
  }

  // Prefer entries from your_posts_*.json (post.timestamp) over album/video
  // files (media creation_timestamp) when the same photo/video appears in both.
  const dedupedPosts = dedupeParsedPosts(allPosts);

  if (dedupedPosts.length === 0) {
    throw new Error("No posts found in the exported JSON files.");
  }

  const getMedia = async (uri: string): Promise<Buffer | null> => {
    const normalized = uri.replace(/^\/+/, "");
    const filename = uri.split("/").pop() ?? "";
    const ref =
      mediaEntries.get(normalized) ??
      mediaEntries.get(uri) ??
      mediaEntries.get(filename);
    if (!ref) return null;
    return ref.entry.buffer();
  };

  await runImportJob({ jobId, userId, parsedPosts: dedupedPosts, getMedia });
}
