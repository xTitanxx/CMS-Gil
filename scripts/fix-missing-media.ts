/**
 * Fix Missing Media — Upload missing media for 46 posts that have fewer
 * media items than the FB export shows.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix-missing-media.ts               # dry run
 *   npx tsx --env-file=.env.local scripts/fix-missing-media.ts --apply       # actually upload
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, mediaKey } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";

const EXPORTS_DIR = path.join(__dirname, "../sample-exports");
const REPORT_PATH = path.join(EXPORTS_DIR, "audit-report.json");
const USER_ID = "cmnala41x000004lgj4riwp83";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");

function buildMediaIndex(): Map<string, string> {
  const index = new Map<string, string>();
  const indexFiles = [
    path.join(EXPORTS_DIR, "main-export/media-index.txt"),
    path.join(EXPORTS_DIR, "april-export/media-index.txt"),
    path.join(EXPORTS_DIR, "html-media-index.txt"),
  ];
  for (const indexFile of indexFiles) {
    if (!fs.existsSync(indexFile)) continue;
    const lines = fs.readFileSync(indexFile, "utf-8").trim().split("\n");
    for (const line of lines) {
      const [filename, filepath] = line.split("|");
      if (filename && filepath && !index.has(filename)) {
        index.set(filename, filepath);
      }
    }
  }
  return index;
}

interface MissingMediaEntry {
  postId: string;
  sourceId: string | null;
  expected: number;
  actual: number;
  missingUris: string[];
}

async function main() {
  console.log(`🔧 Fix Missing Media ${DRY_RUN ? "(DRY RUN)" : "(APPLYING)"}\n`);

  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf-8"));
  const entries: MissingMediaEntry[] = report.missingMedia;
  console.log(`Posts with missing media: ${entries.length}`);

  const mediaIndex = buildMediaIndex();
  console.log(`Indexed ${mediaIndex.size} media files\n`);

  let totalMissing = 0;
  let totalFound = 0;
  let totalUploaded = 0;
  let totalNotFound = 0;

  for (const entry of entries) {
    const foundFiles: { uri: string; path: string }[] = [];
    const notFound: string[] = [];

    for (const uri of entry.missingUris) {
      const filename = uri.split("/").pop() || "";
      const filePath = mediaIndex.get(filename);
      if (filePath && fs.existsSync(filePath)) {
        foundFiles.push({ uri, path: filePath });
      } else {
        notFound.push(filename);
      }
    }

    totalMissing += entry.missingUris.length;
    totalFound += foundFiles.length;
    totalNotFound += notFound.length;

    if (DRY_RUN) {
      console.log(`  ${entry.postId} | expected:${entry.expected} actual:${entry.actual} | found:${foundFiles.length} missing:${notFound.length}`);
      if (notFound.length > 0) {
        console.log(`    Not found: ${notFound.join(", ")}`);
      }
      continue;
    }

    // Upload missing media
    for (const { uri, path: filePath } of foundFiles) {
      try {
        const buffer = fs.readFileSync(filePath);
        const filename = uri.split("/").pop() ?? "media";
        const mimeType = guessMimeType(filename);
        const key = mediaKey(USER_ID, filename);
        const { hasAudio } = await uploadBuffer(key, buffer);

        await prisma.media.create({
          data: {
            postId: entry.postId,
            storageKey: key,
            originalUri: uri,
            mimeType,
            sizeBytes: buffer.length,
            hasAudio,
          },
        });
        totalUploaded++;
        console.log(`  ✓ ${entry.postId} | ${filename} | ${mimeType}`);
      } catch (err) {
        console.log(`  ✗ ${entry.postId} | ${uri.split("/").pop()} | ${String(err).substring(0, 80)}`);
      }
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  Total missing media items: ${totalMissing}`);
  console.log(`  Found on disk:             ${totalFound}`);
  console.log(`  Not found on disk:         ${totalNotFound}`);
  if (!DRY_RUN) {
    console.log(`  Uploaded:                  ${totalUploaded}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
