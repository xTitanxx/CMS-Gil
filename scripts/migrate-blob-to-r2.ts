/**
 * Migrates media items from dead Vercel Blob URLs to R2.
 * Finds the original files in the Facebook export directories on disk,
 * uploads them to R2, and updates the DB storageKey.
 */
import { prisma } from "../src/lib/prisma";
import { uploadBuffer } from "../src/lib/storage";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const EXPORT_BASE = "/Users/eitan/Downloads/Other/gil_facebook_activity";
const EXPORT_DIRS = ["posts 1", "posts 2", "posts 3", "posts 4 "];

// Search all export dirs for a file matching the FB media ID
function findLocalFile(fbId: string, ext: string): string | null {
  const filename = `${fbId}.${ext}`;
  for (const dir of EXPORT_DIRS) {
    // Check videos/ and various album/media subdirs
    const candidates = [
      path.join(EXPORT_BASE, dir, "media", "videos", filename),
      path.join(EXPORT_BASE, dir, "media", "your_posts", filename),
    ];

    // Also check album dirs dynamically
    const albumBase = path.join(EXPORT_BASE, dir, "media");
    if (existsSync(albumBase)) {
      try {
        const { readdirSync } = require("fs");
        for (const sub of readdirSync(albumBase)) {
          candidates.push(path.join(albumBase, sub, filename));
        }
      } catch {}
    }

    for (const p of candidates) {
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function main() {
  const blobMedia = await prisma.media.findMany({
    where: { storageKey: { contains: "blob.vercel-storage.com" } },
    select: { id: true, storageKey: true, mimeType: true, postId: true },
  });

  console.log(`Found ${blobMedia.length} media items on Vercel Blob`);

  let migrated = 0;
  let notFound = 0;
  let failed = 0;

  for (const m of blobMedia) {
    // Extract FB media ID from blob URL: {timestamp}-{fbId}.{ext}
    const blobFilename = m.storageKey.split("/").pop() ?? "";
    const match = blobFilename.match(/^\d+-(.+)\.(\w+)$/);
    if (!match) {
      console.log(`  SKIP ${m.id}: can't parse filename "${blobFilename}"`);
      failed++;
      continue;
    }

    const [, fbId, ext] = match;
    const localPath = findLocalFile(fbId, ext);

    if (!localPath) {
      console.log(`  NOT FOUND ${m.id}: ${fbId}.${ext}`);
      notFound++;
      continue;
    }

    try {
      const buffer = await readFile(localPath);
      const r2Key = `media/${m.postId}/${Date.now()}-${fbId}.${ext}`;
      const result = await uploadBuffer(r2Key, buffer, { contentType: m.mimeType });

      // Update hasAudio if we got a result
      const updateData: Record<string, unknown> = { storageKey: result.url };
      if (result.hasAudio !== null) {
        updateData.hasAudio = result.hasAudio;
      }

      await prisma.media.update({
        where: { id: m.id },
        data: updateData,
      });

      migrated++;
      console.log(`  OK ${m.id}: ${fbId}.${ext} → R2 (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
    } catch (err) {
      console.log(`  FAIL ${m.id}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone: ${migrated} migrated, ${notFound} not found on disk, ${failed} failed`);
  await prisma.$disconnect();
}

main();
