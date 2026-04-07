// src/app/api/import/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, ParsedPost } from "@/lib/facebook-parser";
import { del } from "@vercel/blob";
import unzipper from "unzipper";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const contentType = req.headers.get("content-type") ?? "";
  let blobUrls: string[] = [];
  let directBuffers: { name: string; buffer: Buffer }[] = [];

  if (contentType.includes("multipart/form-data")) {
    // Direct FormData upload (works without Blob token, good for local dev)
    const formData = await req.formData();
    const files = formData.getAll("files") as File[];
    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    for (const file of files) {
      directBuffers.push({
        name: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
      });
    }
  } else {
    // JSON body with Blob URLs (for Vercel production with Blob storage)
    const body = await req.json();
    blobUrls = body.blobUrls;
    if (!Array.isArray(blobUrls) || blobUrls.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
  }

  const fileCount = directBuffers.length || blobUrls.length;
  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: `${fileCount} ZIP files`,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  after(async () => {
    try {
      if (directBuffers.length > 0) {
        await processMultiZipFromBuffers(job.id, userId, directBuffers);
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

interface MediaRef { entry: ZipEntry; dir: unzipper.CentralDirectory }

function indexZipMedia(
  directory: unzipper.CentralDirectory,
  mediaEntries: Map<string, MediaRef>,
  jsonContents: string[]
) {
  for (const entry of directory.files) {
    if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

    const filename = entry.path.split("/").pop() ?? "";

    if (entry.path.match(/\.json$/i)) {
      // JSON files are read synchronously during indexing
      jsonContents.push("__DEFERRED__" + entry.path);
    } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
      const normalized = entry.path.replace(/^\/+/, "");
      const ref = { entry, dir: directory };
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

async function processZipBuffers(
  jobId: string,
  userId: string,
  buffers: Buffer[]
): Promise<void> {
  const mediaEntries = new Map<string, MediaRef>();
  const jsonContents: string[] = [];
  const directories: unzipper.CentralDirectory[] = [];

  for (const buffer of buffers) {
    const directory = await unzipper.Open.buffer(buffer);
    directories.push(directory);
    indexZipMedia(directory, mediaEntries, []);
    const jsons = await readJsonEntries(directory);
    jsonContents.push(...jsons);
  }

  if (jsonContents.length === 0) {
    throw new Error("No JSON files found in the uploaded ZIPs. Make sure you're uploading Facebook data exports.");
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

  if (allPosts.length === 0) {
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

  await runImportJob({ jobId, userId, parsedPosts: allPosts, getMedia });
}

async function processMultiZipFromBuffers(
  jobId: string,
  userId: string,
  files: { name: string; buffer: Buffer }[]
): Promise<void> {
  await processZipBuffers(jobId, userId, files.map(f => f.buffer));
}

async function processMultiZipFromBlob(
  jobId: string,
  userId: string,
  blobUrls: string[]
): Promise<void> {
  const buffers: Buffer[] = [];
  for (const blobUrl of blobUrls) {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ZIP from Blob: ${res.status}`);
    }
    buffers.push(Buffer.from(await res.arrayBuffer()));
  }
  await processZipBuffers(jobId, userId, buffers);
}
