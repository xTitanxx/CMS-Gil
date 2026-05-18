// Audit R2 actual byte size for every video Media row. The DB sizeBytes
// column drifts for older imports, so the backfill's DB-side filter can
// miss videos whose row says "23 MB" but whose R2 object is 300 MB.
// Reports any media where the R2 HEAD size > 20 MB regardless of what
// sizeBytes says.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

const TARGET_BYTES = 20 * 1024 * 1024;
const CONCURRENCY = 8;

interface Row {
  id: string;
  storageKey: string;
  sizeBytes: number;
}

async function headSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return null;
    const len = res.headers.get("content-length");
    return len ? parseInt(len) : null;
  } catch {
    return null;
  }
}

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) return;
        await fn(items[idx]);
      }
    }),
  );
}

(async () => {
  const rows = await prisma.media.findMany({
    where: { mimeType: { startsWith: "video/" } },
    select: { id: true, storageKey: true, sizeBytes: true },
  });
  console.log(`Auditing ${rows.length} videos with HEAD…`);

  const oversized: Array<{
    id: string;
    storageKey: string;
    dbSize: number;
    realSize: number;
  }> = [];

  let done = 0;
  await pool(rows as Row[], CONCURRENCY, async (r) => {
    const real = await headSize(r.storageKey);
    done++;
    if (real != null && real > TARGET_BYTES) {
      oversized.push({
        id: r.id,
        storageKey: r.storageKey,
        dbSize: r.sizeBytes,
        realSize: real,
      });
    }
    if (done % 25 === 0) console.log(`  …${done}/${rows.length}`);
  });

  oversized.sort((a, b) => b.realSize - a.realSize);

  const mismatch = oversized.filter(
    (o) => o.dbSize <= TARGET_BYTES || Math.abs(o.dbSize - o.realSize) > 1024 * 1024,
  );

  console.log(`\nOversized total: ${oversized.length}`);
  console.log(`  DB-correct (will be caught by backfill): ${oversized.length - mismatch.length}`);
  console.log(`  DB drift (will be MISSED by backfill): ${mismatch.length}`);
  if (mismatch.length > 0) {
    console.log(`\nDB-drift rows (real size vs dbSize):`);
    for (const m of mismatch.slice(0, 50)) {
      console.log(
        `  ${m.id}  real=${(m.realSize / 1024 / 1024).toFixed(1)}MB  db=${(m.dbSize / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    if (mismatch.length > 50) console.log(`  …and ${mismatch.length - 50} more`);
  }

  const total = oversized.reduce((s, r) => s + r.realSize, 0);
  console.log(`\nTotal real bytes to process: ${(total / 1024 / 1024).toFixed(1)} MB`);

  await prisma.$disconnect();
})();
