/**
 * Backfill: compress every Media row whose video is larger than the target.
 *
 * For each oversized video:
 *   1. Download from R2.
 *   2. Run `compressVideo` (H.264 + AAC, ~20 MB target, 1280px long-edge cap).
 *   3. Overwrite the same R2 key with the compressed buffer.
 *   4. Update Media.sizeBytes.
 *
 * Idempotent: re-running on already-compressed videos is a near no-op (the
 * `sizeBytes > targetBytes` filter excludes them up-front).
 *
 * Run with:
 *   set -a && source .env.local && set +a
 *   export DATABASE_URL="$POSTGRES_URL_NON_POOLING"
 *   npx tsx scripts/backfill-compress-videos.ts
 *
 * Optional env:
 *   COMPRESS_TARGET_BYTES   override the per-video target (default 20 MB)
 *   COMPRESS_DRY_RUN=1      list candidates without re-encoding
 *   COMPRESS_CONCURRENCY    how many videos to process in parallel (default 2)
 */
import { prisma } from "../src/lib/prisma";
import { uploadBuffer, getObject } from "../src/lib/storage";
import { compressVideo } from "../src/lib/video-processing";

const TARGET_BYTES = Number(process.env.COMPRESS_TARGET_BYTES ?? 20 * 1024 * 1024);
const CONCURRENCY = Number(process.env.COMPRESS_CONCURRENCY ?? 2);
const DRY_RUN = process.env.COMPRESS_DRY_RUN === "1";

const MAX_RETRIES = 3;
// getObject's default 120s timeout is tuned for the publish-lambda hot
// path. Backfilling 300 MB videos from a laptop over residential bandwidth
// blows past that easily, so allow ~15 min per attempt here. Configurable
// via COMPRESS_DOWNLOAD_TIMEOUT_MS for slower links.
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.COMPRESS_DOWNLOAD_TIMEOUT_MS ?? 15 * 60 * 1000,
);

async function downloadWithRetry(url: string): Promise<Buffer> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      return await getObject(url, DOWNLOAD_TIMEOUT_MS);
    } catch (err) {
      if (i === MAX_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error("download exhausted retries");
}

// Storage keys in this codebase are full R2 URLs (see `Media.storageKey`
// comment in CLAUDE.md). Extract the bucket key from the URL pathname.
function keyFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\/+/, "");
}

async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (t: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

type Job = {
  mediaId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
};

type Result =
  | { ok: true; skipped?: boolean; newSize?: number; ratio?: number }
  | { ok: false; error: string };

async function processOne(job: Job): Promise<Result> {
  let buf: Buffer;
  try {
    buf = await downloadWithRetry(job.storageKey);
  } catch (err) {
    return { ok: false, error: `download: ${String(err)}` };
  }

  // Re-check the actual byte size — DB sizeBytes can drift from R2 reality
  // for old media (e.g. someone replaced the object out of band).
  if (buf.length <= TARGET_BYTES) {
    if (job.sizeBytes !== buf.length) {
      await prisma.media.update({
        where: { id: job.mediaId },
        data: { sizeBytes: buf.length },
      });
    }
    return { ok: true, skipped: true };
  }

  let compressed: Buffer;
  try {
    compressed = await compressVideo(buf, { targetBytes: TARGET_BYTES });
  } catch (err) {
    return { ok: false, error: `compress: ${String(err)}` };
  }

  if (compressed === buf || compressed.length >= buf.length) {
    return { ok: true, skipped: true };
  }

  if (DRY_RUN) {
    return {
      ok: true,
      newSize: compressed.length,
      ratio: compressed.length / buf.length,
    };
  }

  try {
    await uploadBuffer(keyFromUrl(job.storageKey), compressed, {
      contentType: job.mimeType,
    });
  } catch (err) {
    return { ok: false, error: `upload: ${String(err)}` };
  }

  await prisma.media.update({
    where: { id: job.mediaId },
    data: { sizeBytes: compressed.length },
  });

  return { ok: true, newSize: compressed.length, ratio: compressed.length / buf.length };
}

function formatBytes(n: number): string {
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

(async () => {
  // FORCE_MEDIA_IDS lets us include rows whose DB sizeBytes is stale (older
  // imports that recorded a synthetic size on a sub-resource). processOne
  // already re-checks real bytes after downloading, so anything we pass in
  // that's actually small below TARGET_BYTES becomes a fast skip.
  const forceIds = (process.env.FORCE_MEDIA_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(
    `Loading oversized video media (sizeBytes > ${formatBytes(TARGET_BYTES)}${
      forceIds.length ? ` OR id IN [${forceIds.length} forced]` : ""
    })…`,
  );
  const rows = await prisma.media.findMany({
    where: {
      mimeType: { startsWith: "video/" },
      OR: [
        { sizeBytes: { gt: TARGET_BYTES } },
        ...(forceIds.length ? [{ id: { in: forceIds } }] : []),
      ],
    },
    select: { id: true, storageKey: true, mimeType: true, sizeBytes: true },
    orderBy: { sizeBytes: "desc" },
  });
  console.log(`Found ${rows.length} oversized videos${DRY_RUN ? " (DRY RUN)" : ""}`);

  if (rows.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  const totalIn = rows.reduce((s, r) => s + r.sizeBytes, 0);
  console.log(`Total input size: ${formatBytes(totalIn)}\n`);

  let done = 0;
  let okCount = 0;
  let skipCount = 0;
  let totalOut = 0;
  const failures: Array<{ mediaId: string; key: string; error: string }> = [];

  await pool(rows, CONCURRENCY, async (row) => {
    const job: Job = {
      mediaId: row.id,
      storageKey: row.storageKey,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
    };
    const r = await processOne(job);
    done++;
    if (r.ok) {
      if (r.skipped) {
        skipCount++;
      } else {
        okCount++;
        totalOut += r.newSize ?? 0;
      }
    } else {
      failures.push({ mediaId: row.id, key: row.storageKey, error: r.error });
    }
    console.log(
      `  [${done}/${rows.length}] ${row.id} ${formatBytes(row.sizeBytes)} → ${
        r.ok
          ? r.skipped
            ? "skipped"
            : `${formatBytes(r.newSize ?? 0)} (${((r.ratio ?? 0) * 100).toFixed(0)}%)`
          : `FAIL: ${r.error}`
      }`
    );
  });

  console.log(`\n=== DONE ===`);
  console.log(`Compressed: ${okCount}`);
  console.log(`Skipped (already small or compressor declined): ${skipCount}`);
  console.log(`Failed: ${failures.length}`);
  if (okCount > 0) {
    const inForCompressed = rows
      .filter((r) => !failures.some((f) => f.mediaId === r.id))
      .reduce((s, r) => s + r.sizeBytes, 0);
    console.log(
      `Total: ${formatBytes(inForCompressed)} → ${formatBytes(totalOut)} (saved ${formatBytes(
        inForCompressed - totalOut
      )})`
    );
  }

  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures.slice(0, 50)) {
      console.log(`  ${f.mediaId}: ${f.error}`);
      console.log(`    ${f.key}`);
    }
    if (failures.length > 50) console.log(`  …and ${failures.length - 50} more`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
