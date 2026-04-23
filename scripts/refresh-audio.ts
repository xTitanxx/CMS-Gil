import { prisma } from "../src/lib/prisma";
import { fetchVideoAudioStatus } from "../src/lib/storage";

(async () => {
  const postId = process.argv[2];
  if (!postId) {
    console.error("usage: tsx scripts/refresh-audio.ts <postId>");
    process.exit(1);
  }
  const rows = await prisma.media.findMany({ where: { postId } });
  if (rows.length === 0) {
    console.log("No media rows for post");
    process.exit(0);
  }
  for (const m of rows) {
    if (!m.mimeType.startsWith("video/")) {
      console.log(`skip ${m.id} (${m.mimeType})`);
      continue;
    }
    const before = m.hasAudio;
    const fresh = await fetchVideoAudioStatus(m.storageKey);
    await prisma.media.update({ where: { id: m.id }, data: { hasAudio: fresh } });
    console.log(`${m.id} ${m.storageKey}: ${before} -> ${fresh}`);
  }
  await prisma.$disconnect();
})();
