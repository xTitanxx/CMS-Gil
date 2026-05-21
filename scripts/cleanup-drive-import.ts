/**
 * One-off cleanup after the broken Drive sync run:
 *
 *   1. Delete ghost Posts — those with no body AND no Media rows AND no
 *      attached audio. Created when import-worker tried to attach media that
 *      wasn't in the export. The fix in import-worker.ts stops new ghosts
 *      from being created; this script removes the ones already there.
 *
 *   2. Delete duplicate PENDING ImportJob rows — pre-fix, the dedup filter
 *      only checked COMPLETED|PROCESSING, so re-clicks of Sync Now queued
 *      the same Drive file multiple times. Keep the oldest PENDING per
 *      sourceFileId; delete the rest.
 *
 * Read-only by default. Pass `--commit` to actually run the deletes.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/cleanup-drive-import.ts [--commit]
 */
import { prisma } from "../src/lib/prisma";

const commit = process.argv.includes("--commit");

(async () => {
  // 1. Ghost posts: source=FACEBOOK, body empty, no Media rows
  const ghosts = await prisma.post.findMany({
    where: {
      source: "FACEBOOK",
      body: "",
      media: { none: {} },
    },
    select: { id: true, sourceId: true, originalDate: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(`Ghost posts (no body, no media): ${ghosts.length}`);
  if (ghosts.length > 0) {
    console.log("  Samples:");
    for (const g of ghosts.slice(0, 5)) {
      console.log(
        `    ${g.id} ${g.sourceId} originalDate=${g.originalDate.toISOString()}`,
      );
    }
  }
  if (commit && ghosts.length > 0) {
    const ids = ghosts.map((g) => g.id);
    const { count } = await prisma.post.deleteMany({ where: { id: { in: ids } } });
    console.log(`  → deleted ${count}`);
  }

  // 2. Duplicate PENDING ImportJob rows — same userId+sourceFileId+source,
  // keep the oldest
  const dupes = await prisma.$queryRaw<
    { id: string; sourceFileId: string; rn: number }[]
  >`
    SELECT id, "sourceFileId", row_number() OVER (
      PARTITION BY "userId", source, "sourceFileId"
      ORDER BY "createdAt" ASC
    ) AS rn
    FROM "ImportJob"
    WHERE source = 'GOOGLE_DRIVE'
      AND status = 'PENDING'
      AND "sourceFileId" IS NOT NULL
  `;
  const toDelete = dupes.filter((d) => Number(d.rn) > 1);
  console.log(`\nDuplicate PENDING jobs: ${toDelete.length}`);
  if (commit && toDelete.length > 0) {
    const { count } = await prisma.importJob.deleteMany({
      where: { id: { in: toDelete.map((d) => d.id) } },
    });
    console.log(`  → deleted ${count}`);
  }

  if (!commit) {
    console.log("\nDry run. Re-run with --commit to apply.");
  }

  await prisma.$disconnect();
})();
