// One-shot: mark any record stuck in PROCESSING for more than 10 min as
// FAILED right now, instead of waiting for the throttled GH Actions cron.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

async function main() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const result = await prisma.publishRecord.updateMany({
    where: { status: "PROCESSING", updatedAt: { lt: cutoff } },
    data: {
      status: "FAILED",
      errorMessage: "Manually reaped — worker lambda died and old cron was throttled",
      retryCount: { increment: 1 },
    },
  });
  console.log("Reaped:", result.count);
}

main().finally(() => prisma.$disconnect());
