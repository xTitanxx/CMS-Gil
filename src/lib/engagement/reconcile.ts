import { prisma } from "@/lib/prisma";

/**
 * Bulk-reconcile denormalized engagement counts on Post.
 *
 * Two pure SQL UPDATEs (one per count column). Milliseconds for ~1.2k posts
 * — far cheaper than the per-post readiness cron loop, and also independent
 * of it (it caps at take:200/run).
 *
 * Drift in practice should be tiny — every mutation already does an
 * in-mutation recompute. This is the safety valve for the rare case (process
 * crash / timeout between insert and count update) and gets called from the
 * admin "Reconcile engagement counts" button.
 */
export async function reconcileEngagementCounts(): Promise<{
  likesUpdated: number;
  commentsUpdated: number;
}> {
  const likesUpdated = await prisma.$executeRaw`
    UPDATE "Post"
    SET "likeCount" = COALESCE(c.cnt, 0)
    FROM (
      SELECT "postId", COUNT(*) AS cnt FROM "PostLike" GROUP BY "postId"
    ) c
    WHERE "Post"."id" = c."postId"
      AND "Post"."likeCount" <> c.cnt
  `;

  // Reset orphans (posts with zero likes whose likeCount drifted up).
  await prisma.$executeRaw`
    UPDATE "Post"
    SET "likeCount" = 0
    WHERE "likeCount" <> 0
      AND NOT EXISTS (SELECT 1 FROM "PostLike" WHERE "PostLike"."postId" = "Post"."id")
  `;

  const commentsUpdated = await prisma.$executeRaw`
    UPDATE "Post"
    SET "commentCount" = COALESCE(c.cnt, 0)
    FROM (
      SELECT "postId", COUNT(*) AS cnt
      FROM "PostComment"
      WHERE "status" = 'PUBLISHED'
      GROUP BY "postId"
    ) c
    WHERE "Post"."id" = c."postId"
      AND "Post"."commentCount" <> c.cnt
  `;

  await prisma.$executeRaw`
    UPDATE "Post"
    SET "commentCount" = 0
    WHERE "commentCount" <> 0
      AND NOT EXISTS (
        SELECT 1 FROM "PostComment"
        WHERE "PostComment"."postId" = "Post"."id"
          AND "PostComment"."status" = 'PUBLISHED'
      )
  `;

  return {
    likesUpdated: Number(likesUpdated),
    commentsUpdated: Number(commentsUpdated),
  };
}
