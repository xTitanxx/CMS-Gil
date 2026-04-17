/**
 * One-shot migration: copy every Media row from Cloudinary to Cloudflare R2.
 *
 * Usage:
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-cloudinary-to-r2.ts --dry
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-cloudinary-to-r2.ts
 *   npx dotenv-cli -e .env.local -- npx tsx scripts/migrate-cloudinary-to-r2.ts --limit=50
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../src/lib/prisma";
import { extractPoster, probeHasAudio } from "../src/lib/video-processing";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME ?? "cms-gil-media";
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const CONCURRENCY = 3;
const DRY = process.argv.includes("--dry");
const LIMIT = (() => {
  const arg = process.argv.find((a) => a.startsWith("--limit="));
  return arg ? parseInt(arg.slice(8), 10) : Infinity;
})();

function r2Url(key: string): string {
  return `${PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
}

function cloudinaryUrl(storageKey: string, mimeType: string): string {
  if (!CLOUDINARY_CLOUD) throw new Error("CLOUDINARY_CLOUD_NAME required");
  const publicId = storageKey.replace(/\.[^/.]+$/, "");
  const isVideoLike = mimeType.startsWith("video/") || mimeType.startsWith("audio/");
  const resourceType = isVideoLike ? "video" : "image";
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/${resourceType}/upload/${publicId}`;
}

function isMigrated(key: string): boolean {
  return /^https?:\/\//.test(key);
}

async function uploadToR2(key: string, body: Buffer, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType })
  );
}

async function migrateOne(media: {
  id: string;
  storageKey: string;
  mimeType: string;
  hasAudio: boolean | null;
}): Promise<{ skipped: boolean; error?: string }> {
  if (isMigrated(media.storageKey)) return { skipped: true };

  const srcUrl = cloudinaryUrl(media.storageKey, media.mimeType);
  const res = await fetch(srcUrl);
  if (!res.ok) return { skipped: false, error: `Cloudinary ${res.status}: ${srcUrl}` };
  const buffer = Buffer.from(await res.arrayBuffer());

  let newStorageKey = media.storageKey;
  if (!DRY) {
    await uploadToR2(media.storageKey, buffer, media.mimeType);
    newStorageKey = r2Url(media.storageKey);
  }

  let hasAudio = media.hasAudio;

  if (media.mimeType.startsWith("video/")) {
    try {
      const poster = await extractPoster(buffer);
      const posterKey = media.storageKey.replace(/\.[^/.]+$/, "") + ".poster.jpg";
      if (!DRY) await uploadToR2(posterKey, poster, "image/jpeg");
    } catch (err) {
      console.warn(`  poster failed for ${media.id}: ${String(err)}`);
    }

    if (hasAudio === null) {
      try { hasAudio = await probeHasAudio(buffer); } catch {}
    }
  }

  if (!DRY) {
    const data: { storageKey?: string; hasAudio?: boolean | null } = {};
    if (newStorageKey !== media.storageKey) data.storageKey = newStorageKey;
    if (hasAudio !== media.hasAudio) data.hasAudio = hasAudio;
    if (Object.keys(data).length > 0) {
      await prisma.media.update({ where: { id: media.id }, data });
    }
  }

  return { skipped: false };
}

async function main() {
  const total = await prisma.media.count();
  const legacyCount = await prisma.media.count({
    where: { NOT: { storageKey: { startsWith: "http" } } },
  });
  console.log(`[migrate] ${total} total media, ${legacyCount} need migration (dry=${DRY}, limit=${LIMIT})`);
  if (legacyCount === 0) { console.log("[migrate] nothing to do"); return; }

  let processed = 0, skipped = 0, failed = 0;
  let cursor: string | null = null;

  outer:
  while (true) {
    const batch = await prisma.media.findMany({
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      where: { NOT: { storageKey: { startsWith: "http" } } },
      orderBy: { id: "asc" },
      select: { id: true, storageKey: true, mimeType: true, hasAudio: true },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;

    const queue = [...batch];
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length && processed < LIMIT) {
          const m = queue.shift();
          if (!m) return;
          try {
            const r = await migrateOne(m);
            if (r.skipped) skipped++;
            else if (r.error) { failed++; console.error(`  FAIL ${m.id}: ${r.error}`); }
            processed++;
            if (processed % 25 === 0) console.log(`[migrate] ${processed}/${legacyCount} (skipped=${skipped}, failed=${failed})`);
          } catch (err) {
            failed++; console.error(`  FAIL ${m.id}: ${String(err)}`); processed++;
          }
        }
      })
    );
    if (processed >= LIMIT) break outer;
  }
  console.log(`[migrate] done. processed=${processed} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
