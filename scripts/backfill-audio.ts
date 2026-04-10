/**
 * Backfill script: populate Media.hasAudio for historical video rows.
 *
 * Walks every Media row where mimeType starts with "video/" and hasAudio IS NULL,
 * in batches of 100. For each row, calls Cloudinary's admin API to fetch the
 * resource metadata and extract the audio track status, then writes it back.
 *
 * The hasAudio IS NULL filter makes the script resumable: interrupted runs pick
 * up exactly where they left off without any bookkeeping.
 *
 * Usage:
 *   npx tsx scripts/backfill-audio.ts
 *   npx tsx scripts/backfill-audio.ts --dry-run
 *   npx tsx scripts/backfill-audio.ts --limit=500
 */

import { prisma } from "../src/lib/prisma";
import { fetchVideoAudioStatus } from "../src/lib/storage";

const BATCH_SIZE = 100;
// Cloudinary's admin API is stingier than the delivery API — keep it modest.
const CONCURRENCY = 5;
const LOG_EVERY = 50;

interface Args {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, limit: null };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a.startsWith("--limit=")) args.limit = Number(a.slice(8));
  }
  return args;
}

/** Simple concurrency limiter — runs fn against every item, at most `limit` in flight. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type ProcessResult =
  | { status: "updated"; hasAudio: boolean | null }
  | { status: "skipped"; reason: string }
  | { status: "error"; error: string };

async function processOne(
  media: { id: string; storageKey: string },
  dryRun: boolean
): Promise<ProcessResult> {
  try {
    const hasAudio = await fetchVideoAudioStatus(media.storageKey);
    if (hasAudio === null) {
      return { status: "skipped", reason: "not a video" };
    }
    if (!dryRun) {
      await prisma.media.update({
        where: { id: media.id },
        data: { hasAudio },
      });
    }
    return { status: "updated", hasAudio };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(
    `Backfill audio — ${args.dryRun ? "DRY RUN" : "LIVE"}${
      args.limit ? ` (limit ${args.limit})` : ""
    }`
  );

  const totalRemaining = await prisma.media.count({
    where: { mimeType: { startsWith: "video/" }, hasAudio: null },
  });
  console.log(`Videos needing backfill: ${totalRemaining}`);
  if (totalRemaining === 0) return;

  const cap = args.limit ?? Infinity;
  let processed = 0;
  let updated = 0;
  let silent = 0;
  let audible = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples: string[] = [];

  // Batch loop: keep fetching rows with hasAudio IS NULL until none remain
  // (or until we hit --limit). Because we update hasAudio inside the loop,
  // the same filter naturally progresses through the dataset.
  while (processed < cap) {
    const take = Math.min(BATCH_SIZE, cap - processed);
    const batch = await prisma.media.findMany({
      where: { mimeType: { startsWith: "video/" }, hasAudio: null },
      select: { id: true, storageKey: true },
      take,
      orderBy: { createdAt: "asc" },
    });
    if (batch.length === 0) break;

    const results = await mapWithConcurrency(batch, CONCURRENCY, (m) =>
      processOne(m, args.dryRun)
    );

    for (const result of results) {
      processed++;
      if (result.status === "updated") {
        updated++;
        if (result.hasAudio) audible++;
        else silent++;
      } else if (result.status === "skipped") {
        skipped++;
      } else {
        errors++;
        if (errorSamples.length < 5) errorSamples.push(result.error);
      }
      if (processed % LOG_EVERY === 0) {
        console.log(
          `  processed=${processed} updated=${updated} audible=${audible} silent=${silent} skipped=${skipped} errors=${errors}`
        );
      }
    }

    // In dry-run mode nothing is written, so the same rows would come back
    // forever — break after the first batch.
    if (args.dryRun) break;
  }

  console.log("\nDone.");
  console.log(`  Processed: ${processed}`);
  console.log(`  Updated:   ${updated}  (audible=${audible}, silent=${silent})`);
  console.log(`  Skipped:   ${skipped}`);
  console.log(`  Errors:    ${errors}`);
  if (errorSamples.length > 0) {
    console.log("\nSample errors:");
    for (const e of errorSamples) console.log(`  - ${e}`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
