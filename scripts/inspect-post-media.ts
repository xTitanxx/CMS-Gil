// Inspect the media on a specific post.
import { config } from "dotenv";
config({ path: ".env.local" });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.POSTGRES_URL_NON_POOLING;
}
import { prisma } from "../src/lib/prisma";

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("usage: tsx inspect-post-media.ts <postId>");
    process.exit(1);
  }
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: {
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          hasAudio: true,
          width: true,
          height: true,
          sizeBytes: true,
        },
      },
    },
  });
  if (!post) {
    console.error("Post not found:", postId);
    return;
  }
  console.log(JSON.stringify(post, null, 2));

  // Try a HEAD on each storage key to get the byte size.
  for (const m of post.media) {
    try {
      const res = await fetch(m.storageKey, { method: "HEAD" });
      const bytes = res.headers.get("content-length");
      const mib = bytes ? (parseInt(bytes) / 1024 / 1024).toFixed(2) : "?";
      console.log(`  [${m.id}] ${m.mimeType} ${mib} MiB status=${res.status}`);
    } catch (err) {
      console.log(`  [${m.id}] HEAD failed:`, err);
    }
  }
}

main().finally(() => prisma.$disconnect());
