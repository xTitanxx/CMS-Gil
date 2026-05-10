/**
 * Backfill missing video posters.
 *
 * For every Media row with mimeType=video/* whose derived .poster.jpg is
 * missing in R2, download the video, run ffmpeg with progressively-relaxed
 * strategies until a frame is produced, and upload the result.
 *
 * Idempotent: HEAD-checks each poster before doing work, so safe to re-run.
 *
 * Run with:
 *   set -a && source .env.local && set +a
 *   export DATABASE_URL="$POSTGRES_URL_NON_POOLING"
 *   npx tsx scripts/backfill-video-posters.ts
 */
import { prisma } from "../src/lib/prisma";
import { uploadBuffer } from "../src/lib/storage";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

const CONCURRENCY = 3; // R2 throttles HEADs at higher concurrency (saw 429s at 16)
const MAX_RETRIES = 3;

type Strategy = { name: string; opts: string[] };
const STRATEGIES: Strategy[] = [
  { name: "frame:v 1", opts: ["-frames:v 1", "-q:v 3"] },
  { name: "seek 0.5s -an", opts: ["-ss 0.5", "-an", "-frames:v 1", "-q:v 3"] },
  { name: "seek 2s -an", opts: ["-ss 2", "-an", "-frames:v 1", "-q:v 3"] },
  { name: "seek 25%", opts: ["-ss 5", "-an", "-frames:v 1", "-q:v 5"] },
];

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "poster-bf-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

async function extractWithStrategy(
  videoBuffer: Buffer,
  strategy: Strategy
): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inp = join(dir, "in.mp4");
    const out = join(dir, "out.jpg");
    writeFileSync(inp, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inp)
        .outputOptions(strategy.opts)
        .on("end", () => resolve())
        .on("error", reject)
        .save(out);
    });

    const size = statSync(out).size;
    if (size === 0) throw new Error("output 0 bytes");
    return readFileSync(out);
  });
}

async function extractRobust(buf: Buffer): Promise<{ poster: Buffer; via: string }> {
  let lastErr: unknown = null;
  for (const s of STRATEGIES) {
    try {
      const poster = await extractWithStrategy(buf, s);
      return { poster, via: s.name };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `all strategies failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

async function headWithRetry(url: string): Promise<number> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      return res.status;
    } catch {
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  return -1;
}

async function downloadWithRetry(url: string): Promise<Buffer> {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      if (i === MAX_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error("download exhausted retries");
}

function posterKeyFromVideoUrl(videoUrl: string): { posterUrl: string; key: string } {
  const u = new URL(videoUrl);
  const key = u.pathname.replace(/^\/+/, "").replace(/\.[^/.]+$/, "") + ".poster.jpg";
  const posterUrl = videoUrl.replace(/\.[^/.]+$/, ".poster.jpg");
  return { posterUrl, key };
}

type Job = {
  mediaId: string;
  postId: string;
  videoUrl: string;
  posterUrl: string;
  key: string;
};

async function processOne(job: Job): Promise<{
  ok: boolean;
  via?: string;
  error?: string;
  skipped?: boolean;
}> {
  // Re-check (handles 429s + concurrent backfill runs)
  const status = await headWithRetry(job.posterUrl);
  if (status === 200) return { ok: true, skipped: true };

  let buf: Buffer;
  try {
    buf = await downloadWithRetry(job.videoUrl);
  } catch (err) {
    return { ok: false, error: `download: ${String(err)}` };
  }

  let poster: Buffer;
  let via: string;
  try {
    const r = await extractRobust(buf);
    poster = r.poster;
    via = r.via;
  } catch (err) {
    return { ok: false, error: `extract: ${String(err)}` };
  }

  try {
    await uploadBuffer(job.key, poster, { contentType: "image/jpeg" });
  } catch (err) {
    return { ok: false, error: `upload: ${String(err)}` };
  }

  return { ok: true, via };
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

(async () => {
  console.log("Loading video media rows…");
  const videos = await prisma.media.findMany({
    where: { mimeType: { startsWith: "video/" } },
    select: { id: true, postId: true, storageKey: true },
  });
  console.log(`Total video media: ${videos.length}`);

  console.log("Checking which posters are missing (with 429 retry)…");
  const checked = await pool(videos, CONCURRENCY, async (m) => {
    const { posterUrl, key } = posterKeyFromVideoUrl(m.storageKey);
    const status = await headWithRetry(posterUrl);
    return { ...m, posterUrl, key, status };
  });

  const missing = checked.filter((c) => c.status !== 200);
  console.log(`Missing: ${missing.length}/${videos.length}`);

  if (missing.length === 0) {
    console.log("Nothing to do.");
    await prisma.$disconnect();
    return;
  }

  console.log(`\nProcessing ${missing.length} videos with concurrency=${CONCURRENCY}…`);
  let done = 0;
  let okCount = 0;
  let skipCount = 0;
  const failures: Array<{ mediaId: string; videoUrl: string; error: string }> = [];

  const results = await pool(missing, CONCURRENCY, async (job, idx) => {
    const r = await processOne({
      mediaId: job.id,
      postId: job.postId,
      videoUrl: job.storageKey,
      posterUrl: job.posterUrl,
      key: job.key,
    });
    done++;
    if (r.ok) {
      if (r.skipped) skipCount++;
      else okCount++;
    } else {
      failures.push({
        mediaId: job.id,
        videoUrl: job.storageKey,
        error: r.error ?? "unknown",
      });
    }
    if (done % 10 === 0 || done === missing.length) {
      console.log(
        `  [${done}/${missing.length}] ok=${okCount} skipped=${skipCount} failed=${failures.length}`
      );
    }
    return r;
  });

  console.log(`\n=== DONE ===`);
  console.log(`Generated posters: ${okCount}`);
  console.log(`Skipped (already had): ${skipCount}`);
  console.log(`Failed: ${failures.length}`);

  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures.slice(0, 50)) {
      console.log(`  ${f.mediaId}: ${f.error}`);
      console.log(`    ${f.videoUrl}`);
    }
    if (failures.length > 50) console.log(`  …and ${failures.length - 50} more`);
  }

  await prisma.$disconnect();
})().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
