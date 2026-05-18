// Look at very recent PublishRecords (last 24h, any status).
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

async function main() {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const rows = await prisma.publishRecord.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      platform: true,
      status: true,
      errorMessage: true,
      scheduledAt: true,
      createdAt: true,
      updatedAt: true,
      retryCount: true,
      postId: true,
      platformUrl: true,
    },
  });
  for (const r of rows) {
    console.log(
      JSON.stringify(
        {
          ...r,
          errorMessage: r.errorMessage?.slice(0, 200) ?? null,
        },
        null,
        2,
      ),
    );
  }
  console.log(`\nTotal: ${rows.length} record(s) in the last 24h`);
}

main().finally(() => prisma.$disconnect());
