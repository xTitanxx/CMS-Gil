/**
 * Backfill Post.bodyNormalized for every row whose bodyNormalized is still
 * empty (or out of sync with body after a normalizer change).
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-body-normalized.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-body-normalized.ts --all
 *     (--all rewrites every row, not just empty ones)
 */
import { prisma } from "../src/lib/prisma";
import { normalizeForSearch } from "../src/lib/search-normalize";

async function main() {
  const all = process.argv.includes("--all");
  const posts = await prisma.post.findMany({
    where: all ? {} : { bodyNormalized: "" },
    select: { id: true, body: true },
  });
  console.log(`Backfilling ${posts.length} post(s)...`);

  // Idempotent updates — run sequentially (no transactions) to avoid the
  // interactive-tx timeout on large batches. Parallel in small chunks.
  const PARALLEL = 20;
  let done = 0;
  for (let i = 0; i < posts.length; i += PARALLEL) {
    const batch = posts.slice(i, i + PARALLEL);
    await Promise.all(
      batch.map((p) =>
        prisma.post.update({
          where: { id: p.id },
          data: { bodyNormalized: normalizeForSearch(p.body) },
        })
      )
    );
    done += batch.length;
    if (done % 200 === 0 || done === posts.length) {
      console.log(`  ${done}/${posts.length}`);
    }
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
