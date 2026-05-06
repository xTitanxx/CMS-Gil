/**
 * One-shot: applies prisma/migrations/20260506000000_add_post_embedding/migration.sql.
 *
 * The repo can't use `prisma migrate dev` (CLAUDE.md note: shadow DB constraint
 * on the prod pooler). This script runs the SQL through the same pg Pool the
 * app uses, then marks the migration as applied in _prisma_migrations.
 *
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/apply-embedding-migration.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

const MIGRATION_DIR = "20260506000000_add_post_embedding";

async function main() {
  const sqlPath = join(__dirname, "..", "prisma", "migrations", MIGRATION_DIR, "migration.sql");
  const sql = readFileSync(sqlPath, "utf-8");

  console.log("Applying migration:", MIGRATION_DIR);

  // Strip line comments and split on semicolons. The migration is idempotent
  // (IF NOT EXISTS guards), so re-running won't fail.
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    const head = stmt.replace(/\s+/g, " ").slice(0, 80);
    console.log("  →", head);
    await prisma.$executeRawUnsafe(stmt);
  }

  // Mark migration as applied in _prisma_migrations so future `prisma migrate
  // status` reflects the truth. Match the schema columns Prisma expects.
  // Idempotent: skip if already recorded.
  const existing = await prisma.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM _prisma_migrations WHERE migration_name = ${MIGRATION_DIR}
  `;
  if (existing.length === 0) {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
      VALUES (
        gen_random_uuid()::text,
        'applied-by-script',
        ${MIGRATION_DIR},
        NOW(),
        NOW(),
        1
      )
    `);
    console.log("Marked migration as applied in _prisma_migrations.");
  } else {
    console.log("Migration already recorded in _prisma_migrations.");
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
