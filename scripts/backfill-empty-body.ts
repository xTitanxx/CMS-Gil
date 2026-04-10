/**
 * One-shot backfill: replace "(no text)" placeholder bodies with "".
 *
 * Older imports wrote "(no text)" directly into Post.body when the Facebook
 * export didn't include caption text. Display code now renders an empty body
 * as "No caption" (subtle, italic), so the sentinel string is no longer
 * needed — and it looks bad if it leaks through.
 *
 * Usage:
 *   npx tsx scripts/backfill-empty-body.ts
 *   npx tsx scripts/backfill-empty-body.ts --dry-run
 */

import { prisma } from "../src/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const matches = await prisma.post.count({
    where: { body: "(no text)" },
  });
  console.log(`Found ${matches} posts with body = "(no text)"`);
  if (matches === 0) return;
  if (dryRun) {
    console.log("Dry run — no changes written.");
    return;
  }
  const { count } = await prisma.post.updateMany({
    where: { body: "(no text)" },
    data: { body: "" },
  });
  console.log(`Updated ${count} posts to empty body.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
