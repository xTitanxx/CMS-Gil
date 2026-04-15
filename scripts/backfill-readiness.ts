import { prisma } from "../src/lib/prisma";
import { computeReadiness } from "../src/lib/readiness";

async function main() {
  const total = await prisma.post.count({ where: { readiness: "UNCHECKED" } });
  console.log(`Posts to check: ${total}`);
  let cursor: string | null = null;
  let processed = 0;
  while (true) {
    const batch = cursor
      ? await prisma.post.findMany({
          where: { readiness: "UNCHECKED" },
          include: { media: true },
          take: 200,
          skip: 1,
          cursor: { id: cursor },
          orderBy: { id: "asc" },
        })
      : await prisma.post.findMany({
          where: { readiness: "UNCHECKED" },
          include: { media: true },
          take: 200,
          orderBy: { id: "asc" },
        });
    if (batch.length === 0) break;
    for (const post of batch) {
      const { readiness, reasons } = computeReadiness(
        {
          body: post.body,
          share: post.share,
          readiness: post.readiness,
          notReadyReasons: post.notReadyReasons,
        },
        post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
      );
      await prisma.post.update({
        where: { id: post.id },
        data: { readiness, notReadyReasons: reasons, readinessCheckedAt: new Date() },
      });
      processed++;
    }
    cursor = batch[batch.length - 1].id;
    console.log(`  processed=${processed}/${total}`);
  }
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
