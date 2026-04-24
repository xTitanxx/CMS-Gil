/**
 * Recovers the 2 legacy Media rows whose files are not on Cloudinary or R2,
 * using the local Facebook export copies on disk. Uploads to R2 (plus poster)
 * and rewrites Media.storageKey to the R2 URL.
 *
 * Usage: npx dotenv-cli -e .env.production -- npx tsx scripts/recover-orphaned-videos.ts
 */
import { prisma } from "../src/lib/prisma";
import { uploadBuffer } from "../src/lib/storage";
import { extractPoster, probeHasAudio } from "../src/lib/video-processing";
import { readFile } from "fs/promises";

const SOURCES: Record<string, string> = {
  "media/cmnala41x000004lgj4riwp83/1776210059105-1431512545045749.mp4":
    "/Users/eitan/Local Sites/gilaltercom/app/public/wp-content/themes/your_facebook_activity/posts/media/videos/1431512545045749.mp4",
  "media/cmnala41x000004lgj4riwp83/1776246216054-1296017899048636.mp4":
    "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports/_original-layout/JSONs/Unzipped JSONs/meta-2026-Apr-06-00-26-54 3/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1296017899048636.mp4",
};

async function main() {
  for (const [storageKey, srcPath] of Object.entries(SOURCES)) {
    console.log(`[recover] ${storageKey}`);
    const buffer = await readFile(srcPath);
    console.log(`  read ${(buffer.length / 1024 / 1024).toFixed(1)} MB`);

    const { url, hasAudio } = await uploadBuffer(storageKey, buffer, {
      contentType: "video/mp4",
    });
    console.log(`  uploaded → ${url} (hasAudio=${hasAudio})`);

    try {
      const poster = await extractPoster(buffer);
      const posterKey = storageKey.replace(/\.[^/.]+$/, "") + ".poster.jpg";
      await uploadBuffer(posterKey, poster, { contentType: "image/jpeg" });
      console.log(`  poster uploaded: ${posterKey}`);
    } catch (err) {
      console.warn(`  poster failed: ${String(err)}`);
    }

    let finalHasAudio = hasAudio;
    if (finalHasAudio === null) {
      try {
        finalHasAudio = await probeHasAudio(buffer);
      } catch {}
    }

    const updated = await prisma.media.updateMany({
      where: { storageKey },
      data: { storageKey: url, hasAudio: finalHasAudio },
    });
    console.log(`  DB rows updated: ${updated.count}`);
  }

  const remaining = await prisma.media.count({
    where: { NOT: { storageKey: { startsWith: "http" } } },
  });
  console.log(`[recover] done. remaining legacy rows: ${remaining}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
