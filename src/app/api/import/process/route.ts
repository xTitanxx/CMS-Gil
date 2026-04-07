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

  const body = await req.json();
  const blobUrls: string[] = body.blobUrls;

  if (!Array.isArray(blobUrls) || blobUrls.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: `${blobUrls.length} ZIP files`,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  after(async () => {
    try {
      await processMultiZip(job.id, userId, blobUrls);
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
      // Clean up all Blob files regardless of success/failure
      for (const url of blobUrls) {
        del(url).catch(() => {});
      }
    }
  });

  return NextResponse.json({ jobId: job.id });
}

type ZipEntry = unzipper.File;

async function processMultiZip(
  jobId: string,
  userId: string,
  blobUrls: string[]
): Promise<void> {
  // Merged state across all ZIPs
  const mediaEntries = new Map<string, { url: string; entry: ZipEntry; dir: unzipper.CentralDirectory }>();
  const jsonContents: string[] = [];

  // We need to keep directory references alive so entries remain readable.
  // Store them in an array so they aren't garbage collected.
  const directories: unzipper.CentralDirectory[] = [];

  for (const blobUrl of blobUrls) {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ZIP from Blob: ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const directory = await unzipper.Open.buffer(buffer);
    directories.push(directory);

    for (const entry of directory.files) {
      if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

      const filename = entry.path.split("/").pop() ?? "";

      if (entry.path.match(/\.json$/i)) {
        const entryBuffer = await entry.buffer();
        jsonContents.push(entryBuffer.toString("utf-8"));
      } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
        // Store by full path, normalized path, and filename-only
        const normalized = entry.path.replace(/^\/+/, "");
        const ref = { url: blobUrl, entry, dir: directory };
        mediaEntries.set(entry.path, ref);
        mediaEntries.set(normalized, ref);
        // Also store by the relative path WITHOUT the top-level facebook folder prefix
        // e.g. "facebook-gilalter7-.../your_facebook_activity/posts/media/..."
        //    -> "your_facebook_activity/posts/media/..."
        // This matches the URI format used in the JSON files
        const parts = normalized.split("/");
        if (parts.length > 1) {
          // Try stripping the first directory segment (the facebook-xxx folder)
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

  if (jsonContents.length === 0) {
    throw new Error("No JSON files found in the uploaded ZIPs. Make sure you're uploading Facebook data exports.");
  }

  // Parse all JSON files
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

  // Lazy media loader — reads one file at a time from the ZIP buffers
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
