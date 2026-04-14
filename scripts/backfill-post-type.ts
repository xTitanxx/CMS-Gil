/**
 * Backfills Post.postType from fb: tags and removes the fb: tags.
 *
 * Usage:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-post-type.ts
 */
import { prisma } from "../src/lib/prisma";

async function main() {
  // 1. Backfill postType from fb: tags
  const reels = await prisma.post.updateMany({
    where: { tags: { has: "fb:reel" } },
    data: { postType: "REEL" },
  });
  console.log("Set REEL:", reels.count);

  const stories = await prisma.post.updateMany({
    where: { tags: { has: "fb:story" } },
    data: { postType: "STORY" },
  });
  console.log("Set STORY:", stories.count);

  // POST is already the default — no update needed for fb:post

  // 2. Remove fb: tags from all posts
  const postsWithFbTags = await prisma.post.findMany({
    where: {
      tags: { hasSome: ["fb:post", "fb:reel", "fb:story"] },
    },
    select: { id: true, tags: true },
  });

  console.log("Posts with fb: tags to clean:", postsWithFbTags.length);

  const PARALLEL = 20;
  for (let i = 0; i < postsWithFbTags.length; i += PARALLEL) {
    const batch = postsWithFbTags.slice(i, i + PARALLEL);
    await Promise.all(
      batch.map((p) =>
        prisma.post.update({
          where: { id: p.id },
          data: {
            tags: p.tags.filter((t) => !t.startsWith("fb:")),
          },
        })
      )
    );
  }

  console.log("Cleaned fb: tags from all posts");

  // 3. Verify
  const counts = await Promise.all([
    prisma.post.count({ where: { postType: "POST" } }),
    prisma.post.count({ where: { postType: "REEL" } }),
    prisma.post.count({ where: { postType: "STORY" } }),
    prisma.post.count({ where: { tags: { hasSome: ["fb:post", "fb:reel", "fb:story"] } } }),
  ]);
  console.log("Final: POST:", counts[0], "| REEL:", counts[1], "| STORY:", counts[2]);
  console.log("Remaining fb: tags:", counts[3], "(should be 0)");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
