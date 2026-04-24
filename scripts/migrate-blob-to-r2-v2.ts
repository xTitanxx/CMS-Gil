/**
 * Migrates the 22 Media rows whose storageKey points at dead Vercel Blob URLs
 * → R2. Files sourced from local FB export copies (paths precomputed).
 *
 * Blob URL shape:
 *   https://{hash}.public.blob.vercel-storage.com/media/{userId}/{ts}-{fbId}.{ext}
 *
 * Keeps the same {userId}/{ts}-{fbId}.{ext} R2 key so the path shape matches
 * everything else, then rewrites storageKey to the full R2 URL.
 *
 * Usage:
 *   npx dotenv-cli -e .env.production -- npx tsx scripts/migrate-blob-to-r2-v2.ts [--dry]
 */
import { prisma } from "../src/lib/prisma";
import { uploadBuffer } from "../src/lib/storage";
import { extractPoster, probeHasAudio } from "../src/lib/video-processing";
import { readFile } from "fs/promises";

const DRY = process.argv.includes("--dry");

const EXPORT_BASE =
  "/Users/eitan/Documents/Code-Projects/CMS-Gil.nosync/sample-exports/_original-layout/JSONs/Unzipped JSONs";

// FB media ID → local path. Precomputed from `find` across sample-exports/.
const LOCAL_PATHS: Record<string, string> = {
  "4298924056919805": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 5/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/Mobileuploads_117012181777701/4298924056919805.jpg`,
  "4519341581722431": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 6/facebook-gilalter7-2026-04-06-kJehMVgd/your_facebook_activity/posts/media/videos/4519341581722431.mp4`,
  "1356816683156284": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 8/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/1356816683156284.mp4`,
  "2071955996710214": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 8/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/2071955996710214.mp4`,
  "922527493600838": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 8/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/922527493600838.mp4`,
  "926505520131573": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 7/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/926505520131573.mp4`,
  "1468017764743134": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 7/facebook-gilalter7-2026-04-06-kJehMVgd/your_facebook_activity/posts/media/videos/1468017764743134.mp4`,
  "1498888498269254": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 6/facebook-gilalter7-2026-04-06-vY4dQcYZ/your_facebook_activity/posts/media/videos/1498888498269254.mp4`,
  "1291256482025581": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 3/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1291256482025581.mp4`,
  "1153455096142366": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 5/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1153455096142366.mp4`,
  "1277592783521250": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 5/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1277592783521250.mp4`,
  "1118694972969472": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 3/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1118694972969472.mp4`,
  "1088549386350661": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 3/facebook-gilalter7-2026-04-06-cROiSgas/your_facebook_activity/posts/media/videos/1088549386350661.mp4`,
  "627314576606041": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 8/facebook-gilalter7-2026-04-06-kJehMVgd/your_facebook_activity/posts/media/videos/627314576606041.mp4`,
  "982321197333478": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 4/facebook-gilalter7-2026-04-06-PtoHT8d6/your_facebook_activity/posts/media/videos/982321197333478.mp4`,
  "1819509238616163": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 7/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/1819509238616163.mp4`,
  "2063190787513528": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 4/facebook-gilalter7-2026-04-06-PtoHT8d6/your_facebook_activity/posts/media/videos/2063190787513528.mp4`,
  "4068471283425831": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 9/facebook-gilalter7-2026-04-06-vY4dQcYZ/your_facebook_activity/posts/media/videos/4068471283425831.mp4`,
  "1039391474190548": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 7/facebook-gilalter7-2026-04-06-iXuQalQ3/your_facebook_activity/posts/media/videos/1039391474190548.mp4`,
  "1041762214718538": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 10/facebook-gilalter7-2026-04-06-vY4dQcYZ/your_facebook_activity/posts/media/videos/1041762214718538.mp4`,
  "1241780793543655": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 6/facebook-gilalter7-2026-04-06-vY4dQcYZ/your_facebook_activity/posts/media/videos/1241780793543655.mp4`,
  "1091904222798965": `${EXPORT_BASE}/meta-2026-Apr-06-00-26-54 6/facebook-gilalter7-2026-04-06-vY4dQcYZ/your_facebook_activity/posts/media/videos/1091904222798965.mp4`,
};

function parseBlobUrl(
  url: string
): { r2Key: string; fbId: string; ext: string } | null {
  const m = url.match(
    /public\.blob\.vercel-storage\.com\/(media\/[^/]+\/(\d+)-(\d+)\.(\w+))$/
  );
  if (!m) return null;
  return { r2Key: m[1], fbId: m[3], ext: m[4] };
}

async function main() {
  const rows = await prisma.media.findMany({
    where: { storageKey: { contains: "blob.vercel-storage.com" } },
    select: { id: true, storageKey: true, mimeType: true, postId: true },
  });
  console.log(`[migrate-blob] ${rows.length} rows to process (dry=${DRY})`);

  let migrated = 0;
  let missing = 0;
  let failed = 0;

  for (const row of rows) {
    const parsed = parseBlobUrl(row.storageKey);
    if (!parsed) {
      console.log(`  BAD URL ${row.id}: ${row.storageKey}`);
      failed++;
      continue;
    }

    const localPath = LOCAL_PATHS[parsed.fbId];
    if (!localPath) {
      console.log(`  MISSING ${row.id}: ${parsed.fbId}.${parsed.ext}`);
      missing++;
      continue;
    }

    try {
      const buffer = await readFile(localPath);
      const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);
      console.log(
        `  ${row.id}: ${parsed.fbId}.${parsed.ext} (${sizeMb} MB) → ${parsed.r2Key}`
      );

      if (DRY) {
        migrated++;
        continue;
      }

      const { url, hasAudio } = await uploadBuffer(parsed.r2Key, buffer, {
        contentType: row.mimeType,
      });

      let finalHasAudio = hasAudio;
      if (row.mimeType.startsWith("video/")) {
        try {
          const poster = await extractPoster(buffer);
          const posterKey = parsed.r2Key.replace(/\.[^/.]+$/, "") + ".poster.jpg";
          await uploadBuffer(posterKey, poster, { contentType: "image/jpeg" });
        } catch (err) {
          console.warn(`    poster failed: ${String(err)}`);
        }
        if (finalHasAudio === null) {
          try {
            finalHasAudio = await probeHasAudio(buffer);
          } catch {}
        }
      }

      await prisma.media.update({
        where: { id: row.id },
        data: { storageKey: url, hasAudio: finalHasAudio },
      });
      migrated++;
    } catch (err) {
      console.error(`  FAIL ${row.id}: ${String(err)}`);
      failed++;
    }
  }

  const remaining = await prisma.media.count({
    where: { storageKey: { contains: "blob.vercel-storage.com" } },
  });
  console.log(
    `[migrate-blob] done. migrated=${migrated} missing=${missing} failed=${failed} remaining=${remaining}`
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
