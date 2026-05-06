/**
 * Backfill Post.embedding for every row that lacks one.
 *
 * Generates Voyage voyage-3-lite embeddings (512-dim) for "Tags: {tags}\n{body}"
 * and writes them via $queryRaw (Prisma 7 has no native vector type). Runs
 * newest-first so the latest content becomes searchable as the script progresses.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-post-embeddings.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-post-embeddings.ts --rebuild
 *     (--rebuild re-embeds every row, not just rows where embedding IS NULL)
 *
 * Cost: ~$0.02/1M tokens × ~300 tok/post = ~$0.006 per 1000 posts.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  buildPostEmbeddingText,
  embedDocuments,
  toPgVectorLiteral,
} from "../src/lib/retrieval/embed";

const BATCH_SIZE = 16; // posts per Voyage call (well under 1000-input limit)

// Voyage free tier: 3 RPM / 10K TPM until a payment method is added. We hold a
// request floor of 22s between Voyage calls — over the 20s/req that 3 RPM
// implies, with margin for clock drift. Drop this once billing is set up.
const FREE_TIER_DELAY_MS = 22_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Supabase Postgres closes idle TCP connections after a few minutes — even
// with idleTimeoutMillis: 0 in our local pg pool. With ~22s sleeps between
// batches, we sometimes go long enough that a SQL call lands on a half-dead
// socket and gets "Connection terminated unexpectedly". Retry once on those
// errors; pg/prisma reopens a fresh connection from the pool transparently.
async function withDbRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Connection terminated") || msg.includes("ECONNRESET")) {
      console.warn(`[${label}] connection dropped — retrying once.`);
      await sleep(500);
      return await fn();
    }
    throw e;
  }
}

async function main() {
  const rebuild = process.argv.includes("--rebuild");

  // Use $queryRaw to filter on the Unsupported("vector(512)") column —
  // Prisma's findMany WHERE doesn't expose embedding IS NULL filtering.
  const idRows = rebuild
    ? await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Post" ORDER BY "originalDate" DESC
      `
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM "Post" WHERE embedding IS NULL ORDER BY "originalDate" DESC
      `;

  if (idRows.length === 0) {
    console.log("Nothing to do — all posts already have embeddings.");
    return;
  }
  console.log(`Embedding ${idRows.length} post(s)…`);

  let done = 0;
  let skipped = 0;
  for (let i = 0; i < idRows.length; i += BATCH_SIZE) {
    const batchIds = idRows.slice(i, i + BATCH_SIZE).map((r) => r.id);
    const batch = await withDbRetry("findMany", () =>
      prisma.post.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, body: true, tags: true, captionSuggestion: true },
      }),
    );
    // Preserve newest-first ordering.
    batch.sort(
      (a, b) => batchIds.indexOf(a.id) - batchIds.indexOf(b.id),
    );

    const texts = batch.map((p) =>
      buildPostEmbeddingText({
        body: p.body,
        tags: p.tags,
        captionSuggestion: p.captionSuggestion,
      }),
    );

    // Skip rows whose generated text is empty (no body, no tags, no caption).
    const usable = batch
      .map((p, idx) => ({ post: p, text: texts[idx] }))
      .filter(({ text }) => text.trim().length > 0);
    skipped += batch.length - usable.length;

    if (usable.length === 0) {
      done += batch.length;
      continue;
    }

    if (i > 0) await sleep(FREE_TIER_DELAY_MS);
    const vectors = await embedDocuments(usable.map((u) => u.text));
    if (!vectors) {
      console.error(
        "Voyage call failed (or VOYAGE_API_KEY missing). Aborting backfill.",
      );
      process.exit(1);
    }

    // Sequential awaits, no $transaction — pgbouncer transaction-pool times
    // out on long $transaction blocks (P2028). Same pattern as recordUsage in
    // src/lib/subscribers/budget.ts.
    for (let j = 0; j < usable.length; j++) {
      const { post } = usable[j];
      const vec = toPgVectorLiteral(vectors[j]);
      await withDbRetry("update", () =>
        prisma.$executeRaw(Prisma.sql`
          UPDATE "Post" SET embedding = ${vec}::vector WHERE id = ${post.id}
        `),
      );
    }

    done += batch.length;
    if (done % 80 === 0 || done >= idRows.length) {
      console.log(`  ${done}/${idRows.length} (skipped ${skipped} empty)`);
    }
  }

  console.log(`Done. Embedded ${done - skipped} post(s); skipped ${skipped} empty.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
