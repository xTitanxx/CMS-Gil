// Query stuck publish records (PENDING/PROCESSING) and recent failures.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

async function main() {
  const stuck = await prisma.publishRecord.findMany({
    where: { status: { in: ["PENDING", "PROCESSING"] } },
    orderBy: { createdAt: "desc" },
    take: 30,
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
    },
  });
  console.log("--- stuck PENDING/PROCESSING ---");
  console.log(JSON.stringify(stuck, null, 2));

  const recentFailed = await prisma.publishRecord.findMany({
    where: { status: "FAILED", platform: { in: ["LINKEDIN", "YOUTUBE"] } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      platform: true,
      status: true,
      errorMessage: true,
      createdAt: true,
      updatedAt: true,
      retryCount: true,
    },
  });
  console.log("\n--- recent FAILED LinkedIn/YouTube ---");
  console.log(JSON.stringify(recentFailed, null, 2));
}

main().finally(() => prisma.$disconnect());
