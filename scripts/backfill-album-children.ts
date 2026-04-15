/**
 * Backfill Post.parentPostId for posts whose photos appear inside another
 * (multi-media) "album" post.
 *
 * When Facebook exports an album, the album itself is one post with N images,
 * but each individual image often *also* exists as its own post (with a
 * different caption / location / date). We detect this by extracting the FB
 * media ID from each Media.storageKey filename ("…-<mediaId>.jpg") and linking
 * any post that shares a media ID with a larger album post.
 *
 * Run:
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-album-children.ts
 *   node --env-file=.env.local node_modules/.bin/tsx scripts/backfill-album-children.ts --dry
 */
import { prisma } from "@/lib/prisma";

const DRY = process.argv.includes("--dry");
const MIN_ALBUM_SIZE = 3; // a post must have at least this many media to count as an album parent

function extractFbId(storageKey: string): string | null {
  // storageKey shape: media/<userId>/<timestamp>-<fbMediaId>.<ext>
  const filename = storageKey.split("/").pop() ?? "";
  const m = filename.match(/-(\d{6,})\.[^.]+$/);
  return m ? m[1] : null;
}

async function main() {
  const albums = await prisma.post.findMany({
    where: { source: "FACEBOOK" },
    select: { id: true, userId: true, media: { select: { storageKey: true } } },
  });
  const albumPosts = albums.filter((p) => p.media.length >= MIN_ALBUM_SIZE);
  console.log(`scanning ${albumPosts.length} candidate album posts`);

  let totalLinked = 0;
  for (const album of albumPosts) {
    const fbIds = album.media.map((m) => extractFbId(m.storageKey)).filter((x): x is string => !!x);
    if (fbIds.length === 0) continue;

    const likes = fbIds.map((id) => `%-${id}.%`);
    const params: unknown[] = [album.userId, album.id, ...likes];
    const rows = await prisma.$queryRawUnsafe<Array<{ postId: string }>>(
      `SELECT DISTINCT m."postId"
       FROM "Media" m
       JOIN "Post" p ON p.id = m."postId"
       WHERE p."userId" = $1
         AND m."postId" <> $2
         AND (${likes.map((_, i) => `m."storageKey" LIKE $${i + 3}`).join(" OR ")})`,
      ...params,
    );
    if (rows.length === 0) continue;

    const childIds = rows.map((r) => r.postId);
    // Don't overwrite an existing parent; only set when null. Also avoid
    // linking another album-sized post as a child of this album.
    const eligible = await prisma.post.findMany({
      where: {
        id: { in: childIds },
        parentPostId: null,
        media: { some: {} },
      },
      select: { id: true, _count: { select: { media: true } } },
    });
    const safe = eligible.filter((p) => p._count.media < MIN_ALBUM_SIZE).map((p) => p.id);
    if (safe.length === 0) continue;

    console.log(`album ${album.id} (${album.media.length} media) → ${safe.length} children`);
    if (!DRY) {
      await prisma.post.updateMany({
        where: { id: { in: safe } },
        data: { parentPostId: album.id },
      });
    }
    totalLinked += safe.length;
  }
  console.log(`${DRY ? "[dry]" : "[done]"} linked ${totalLinked} child posts`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
