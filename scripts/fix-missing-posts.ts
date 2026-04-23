/**
 * Fix Missing Posts — Import 280 posts that exist in FB export but not in DB.
 *
 * Reads the audit report, finds each missing post's media files on disk,
 * uploads to Cloudinary, and creates DB records.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix-missing-posts.ts               # dry run
 *   npx tsx --env-file=.env.local scripts/fix-missing-posts.ts --apply       # actually import
 *   npx tsx --env-file=.env.local scripts/fix-missing-posts.ts --apply --limit=10  # import first 10
 */

import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, mediaKey } from "../src/lib/storage";
import { guessMimeType } from "../src/lib/facebook-parser";
import { normalizeForSearch } from "../src/lib/search-normalize";

const EXPORTS_DIR = path.join(__dirname, "../sample-exports");
const REPORT_PATH = path.join(EXPORTS_DIR, "audit-report.json");
const USER_ID = "cmnala41x000004lgj4riwp83";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");
const LIMIT = (() => {
  const limitArg = args.find(a => a.startsWith("--limit="));
  return limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
})();

// Build media lookup from all index files
function buildMediaIndex(): Map<string, string> {
  const index = new Map<string, string>();

  const indexFiles = [
    path.join(EXPORTS_DIR, "main-export/media-index.txt"),
    path.join(EXPORTS_DIR, "april-export/media-index.txt"),
  ];

  for (const indexFile of indexFiles) {
    if (!fs.existsSync(indexFile)) continue;
    const lines = fs.readFileSync(indexFile, "utf-8").trim().split("\n");
    for (const line of lines) {
      const [filename, filepath] = line.split("|");
      if (filename && filepath) {
        index.set(filename, filepath);
      }
    }
  }

  // Also index HTML media
  const htmlIndex = path.join(EXPORTS_DIR, "html-media-index.txt");
  if (fs.existsSync(htmlIndex)) {
    const lines = fs.readFileSync(htmlIndex, "utf-8").trim().split("\n");
    for (const line of lines) {
      const [filename, filepath] = line.split("|");
      if (filename && filepath && !index.has(filename)) {
        index.set(filename, filepath);
      }
    }
  }

  return index;
}

function findMediaFile(uri: string, mediaIndex: Map<string, string>): string | null {
  const filename = uri.split("/").pop();
  if (!filename) return null;

  // Try exact filename match in index
  const indexed = mediaIndex.get(filename);
  if (indexed && fs.existsSync(indexed)) return indexed;

  // Try walking common paths in the unzipped exports
  const baseDirs = [
    path.join(EXPORTS_DIR, "_original-layout/JSONs/Unzipped JSONs"),
    path.join(EXPORTS_DIR, "_original-layout/HTML"),
  ];

  for (const baseDir of baseDirs) {
    if (!fs.existsSync(baseDir)) continue;
    // The uri usually starts with "your_facebook_activity/posts/media/..."
    // Try to find the file by walking the unzipped exports
    const parts = uri.split("/");
    const mediaFilename = parts.pop();
    if (!mediaFilename) continue;

    // Search in media index by filename only
    const found = mediaIndex.get(mediaFilename);
    if (found && fs.existsSync(found)) return found;
  }

  return null;
}

interface MissingPost {
  sourceId: string;
  body: string;
  originalDate: string;
  mediaUris: string[];
}

async function main() {
  console.log(`🔧 Fix Missing Posts ${DRY_RUN ? "(DRY RUN)" : "(APPLYING)"}\n`);

  // Load audit report
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf-8"));
  const missingPosts: MissingPost[] = report.missingFromDB;
  console.log(`Total missing posts: ${missingPosts.length}`);
  console.log(`Limit: ${LIMIT === Infinity ? "none" : LIMIT}\n`);

  // Build media index
  console.log("Building media file index...");
  const mediaIndex = buildMediaIndex();
  console.log(`Indexed ${mediaIndex.size} media files\n`);

  // Check which posts have their media available
  let mediaAvailable = 0;
  let mediaPartial = 0;
  let mediaMissing = 0;
  let textOnly = 0;

  const importable: { post: MissingPost; files: Map<string, string> }[] = [];

  for (const post of missingPosts) {
    if (post.mediaUris.length === 0) {
      textOnly++;
      importable.push({ post, files: new Map() });
      continue;
    }

    const files = new Map<string, string>();
    for (const uri of post.mediaUris) {
      const file = findMediaFile(uri, mediaIndex);
      if (file) files.set(uri, file);
    }

    if (files.size === post.mediaUris.length) {
      mediaAvailable++;
    } else if (files.size > 0) {
      mediaPartial++;
    } else {
      mediaMissing++;
    }

    // Import if we have at least some media (or it's text-only)
    if (files.size > 0 || post.mediaUris.length === 0) {
      importable.push({ post, files });
    }
  }

  console.log(`Media availability:`);
  console.log(`  All media found:      ${mediaAvailable}`);
  console.log(`  Partial media found:  ${mediaPartial}`);
  console.log(`  No media found:       ${mediaMissing}`);
  console.log(`  Text-only (no media): ${textOnly}`);
  console.log(`  Importable:           ${importable.length}\n`);

  if (DRY_RUN) {
    console.log("--- DRY RUN --- No changes made. Run with --apply to import.\n");

    // Show what would be imported
    for (const { post, files } of importable.slice(0, 20)) {
      const mediaStatus = post.mediaUris.length === 0
        ? "text-only"
        : `${files.size}/${post.mediaUris.length} media`;
      console.log(`  ${post.sourceId} | ${post.originalDate.split("T")[0]} | ${mediaStatus} | "${post.body.substring(0, 50)}"`);
    }
    if (importable.length > 20) console.log(`  ... and ${importable.length - 20} more`);

    // Show posts with no media at all (can't import)
    if (mediaMissing > 0) {
      console.log(`\n  ⚠️ ${mediaMissing} posts have media in FB export but files not found on disk.`);
      const noFiles = missingPosts.filter(p => {
        if (p.mediaUris.length === 0) return false;
        return p.mediaUris.every(uri => !findMediaFile(uri, mediaIndex));
      });
      for (const p of noFiles.slice(0, 10)) {
        console.log(`    ${p.sourceId} | ${p.mediaUris.map(u => u.split("/").pop()).join(", ")}`);
      }
    }

    await prisma.$disconnect();
    return;
  }

  // Actually import
  let imported = 0;
  let failed = 0;
  const errors: string[] = [];

  const toImport = importable.slice(0, LIMIT);
  console.log(`Importing ${toImport.length} posts...\n`);

  for (const { post, files } of toImport) {
    try {
      // Double-check not already in DB
      const existing = await prisma.post.findFirst({
        where: { userId: USER_ID, sourceId: post.sourceId },
      });
      if (existing) {
        console.log(`  SKIP ${post.sourceId} — already in DB`);
        continue;
      }

      // Create post
      const dbPost = await prisma.post.create({
        data: {
          userId: USER_ID,
          body: post.body,
          bodyNormalized: normalizeForSearch(post.body),
          source: "FACEBOOK",
          sourceId: post.sourceId,
          originalDate: new Date(post.originalDate),
        },
      });

      // Upload media
      let mediaCount = 0;
      for (const [uri, filePath] of files) {
        try {
          const buffer = fs.readFileSync(filePath);
          const filename = uri.split("/").pop() ?? "media";
          const mimeType = guessMimeType(filename);
          const key = mediaKey(USER_ID, filename);
          const { hasAudio } = await uploadBuffer(key, buffer);

          await prisma.media.create({
            data: {
              postId: dbPost.id,
              storageKey: key,
              originalUri: uri,
              mimeType,
              sizeBytes: buffer.length,
              hasAudio,
            },
          });
          mediaCount++;
        } catch (mediaErr) {
          errors.push(`Media error ${post.sourceId}/${uri}: ${String(mediaErr)}`);
        }
      }

      imported++;
      console.log(`  ✓ ${post.sourceId} | ${mediaCount} media | "${post.body.substring(0, 50)}"`);
    } catch (err) {
      failed++;
      errors.push(`Post error ${post.sourceId}: ${String(err)}`);
      console.log(`  ✗ ${post.sourceId}: ${String(err).substring(0, 80)}`);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  Imported: ${imported}`);
  console.log(`  Failed:   ${failed}`);
  if (errors.length > 0) {
    console.log(`  Errors:`);
    for (const e of errors.slice(0, 20)) {
      console.log(`    ${e.substring(0, 120)}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
