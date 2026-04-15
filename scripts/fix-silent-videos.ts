/**
 * Fix Silent Videos — Re-upload videos that lost their audio track.
 *
 * For each video with hasAudio=false:
 * 1. Find the original file on disk (via originalUri or storageKey filename)
 * 2. Check if the original file actually has audio (using ffprobe)
 * 3. If it does, re-upload to Cloudinary and update the DB record
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/fix-silent-videos.ts               # dry run (just diagnose)
 *   npx tsx --env-file=.env.local scripts/fix-silent-videos.ts --apply       # re-upload
 *   npx tsx --env-file=.env.local scripts/fix-silent-videos.ts --apply --limit=10
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, mediaKey, deleteObject } from "../src/lib/storage";

const EXPORTS_DIR = path.join(__dirname, "../sample-exports");
const USER_ID = "cmnala41x000004lgj4riwp83";

const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");
const LIMIT = (() => {
  const limitArg = args.find(a => a.startsWith("--limit="));
  return limitArg ? parseInt(limitArg.split("=")[1], 10) : Infinity;
})();

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

/** Check if a video file has an audio track using ffprobe */
function hasAudioTrack(filePath: string): boolean | null {
  try {
    const result = execSync(
      `ffprobe -v quiet -select_streams a -show_entries stream=codec_type -of csv=p=0 "${filePath}"`,
      { encoding: "utf-8", timeout: 10000 }
    ).trim();
    return result.includes("audio");
  } catch {
    // ffprobe not available or failed
    return null;
  }
}

async function main() {
  console.log(`🔧 Fix Silent Videos ${DRY_RUN ? "(DRY RUN)" : "(APPLYING)"}\n`);

  // Check if ffprobe is available
  let ffprobeAvailable = false;
  try {
    execSync("ffprobe -version", { encoding: "utf-8", timeout: 5000 });
    ffprobeAvailable = true;
  } catch {
    console.log("⚠️ ffprobe not found — cannot verify audio tracks locally.");
    console.log("  Will still attempt re-upload (Cloudinary re-checks audio on upload).\n");
  }

  const mediaIndex = buildMediaIndex();
  console.log(`Indexed ${mediaIndex.size} media files`);

  // Get all silent videos from DB
  const silentVideos = await prisma.media.findMany({
    where: {
      hasAudio: false,
      mimeType: { startsWith: "video/" },
      post: { source: "FACEBOOK", userId: USER_ID },
    },
    select: {
      id: true,
      postId: true,
      storageKey: true,
      originalUri: true,
      mimeType: true,
    },
  });

  console.log(`Silent videos in DB: ${silentVideos.length}\n`);

  let found = 0;
  let notFound = 0;
  let hasAudio = 0;
  let trulysilent = 0;
  let reUploaded = 0;
  let errors = 0;
  let probeUnknown = 0;

  const toProcess = silentVideos.slice(0, LIMIT);

  for (const video of toProcess) {
    // Find original file on disk
    const originalFilename = video.originalUri
      ? video.originalUri.split("/").pop()
      : video.storageKey.split("/").pop();

    if (!originalFilename) {
      notFound++;
      continue;
    }

    const filePath = mediaIndex.get(originalFilename);
    if (!filePath || !fs.existsSync(filePath)) {
      notFound++;
      if (DRY_RUN) {
        console.log(`  ✗ ${video.id} | ${originalFilename} — not found on disk`);
      }
      continue;
    }
    found++;

    // Check if original has audio
    if (ffprobeAvailable) {
      const originalHasAudio = hasAudioTrack(filePath);
      if (originalHasAudio === false) {
        trulysilent++;
        if (DRY_RUN) {
          console.log(`  ⊘ ${video.id} | ${originalFilename} — original is also silent (no fix needed)`);
        }
        continue;
      }
      if (originalHasAudio === true) {
        hasAudio++;
      } else {
        probeUnknown++;
      }
    }

    if (DRY_RUN) {
      const status = ffprobeAvailable ? "has audio — would re-upload" : "would re-upload (no ffprobe)";
      console.log(`  ✓ ${video.id} | ${originalFilename} — ${status}`);
      continue;
    }

    // Re-upload
    try {
      const buffer = fs.readFileSync(filePath);
      const newKey = mediaKey(USER_ID, originalFilename);
      const { hasAudio: newHasAudio } = await uploadBuffer(newKey, buffer);

      // Delete old Cloudinary resource
      try {
        await deleteObject(video.storageKey, video.mimeType);
      } catch {
        // Old resource might already be gone, that's OK
      }

      // Update DB record
      await prisma.media.update({
        where: { id: video.id },
        data: {
          storageKey: newKey,
          hasAudio: newHasAudio,
          sizeBytes: buffer.length,
        },
      });

      reUploaded++;
      console.log(`  ✓ ${video.id} | ${originalFilename} | hasAudio=${newHasAudio}`);
    } catch (err) {
      errors++;
      console.log(`  ✗ ${video.id} | ${originalFilename} | ${String(err).substring(0, 80)}`);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`  Total silent videos:       ${silentVideos.length}`);
  console.log(`  Processed:                 ${toProcess.length}`);
  console.log(`  Original found on disk:    ${found}`);
  console.log(`  Original not found:        ${notFound}`);
  if (ffprobeAvailable) {
    console.log(`  Original has audio:        ${hasAudio}`);
    console.log(`  Original truly silent:     ${trulysilent}`);
    console.log(`  Probe unknown:             ${probeUnknown}`);
  }
  if (!DRY_RUN) {
    console.log(`  Re-uploaded:               ${reUploaded}`);
    console.log(`  Errors:                    ${errors}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
