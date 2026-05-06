/**
 * Quick retrieval evaluation. Runs hybridSearch against a list of natural-
 * language queries and prints the top-N hits with match reasons + snippets.
 * Useful for eyeballing recall quality after the backfill, or for comparing
 * runs after tuning hybridSearch.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/eval-retrieval.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/eval-retrieval.ts "your custom query"
 */
import { prisma } from "../src/lib/prisma";
import { hybridSearch } from "../src/lib/retrieval/hybrid-search";

// Hand-picked oblique queries that exercise semantic recall (synonyms,
// thematic, multilingual, paraphrased). Tweak freely.
const DEFAULT_QUERIES = [
  "losing my dad",
  "how do you handle hard mornings",
  "breathing exercises for anxiety",
  "what does Gil say about MS",
  "stories from pesach",
  "depression and getting out of bed",
  "Trekinetic wheelchair",
  "Hebrew school memories",
];

async function evalQuery(userId: string, query: string, limit = 5) {
  console.log(`\n━━━ Query: "${query}" ━━━`);
  const t0 = Date.now();
  const hits = await hybridSearch({ userId, query, limit });
  const elapsed = Date.now() - t0;
  console.log(`  ${hits.length} hits in ${elapsed}ms\n`);
  hits.forEach((h, i) => {
    const snippet = h.highlightSnippet || h.body.slice(0, 120);
    const tags = h.tags.slice(0, 5).join(", ");
    console.log(`  ${i + 1}. [${h.postId}] score=${h.score.toFixed(2)} (${h.matchReasons.join(", ")})`);
    console.log(`     tags: ${tags}`);
    console.log(`     ${snippet}\n`);
  });
}

async function main() {
  const userId = process.env.GIL_USER_ID || process.env.OWNER_USER_ID;
  if (!userId) {
    console.error("Set GIL_USER_ID or OWNER_USER_ID in .env.local");
    process.exit(1);
  }
  const cliQuery = process.argv.slice(2).join(" ").trim();
  const queries = cliQuery ? [cliQuery] : DEFAULT_QUERIES;
  for (const q of queries) {
    await evalQuery(userId, q);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
