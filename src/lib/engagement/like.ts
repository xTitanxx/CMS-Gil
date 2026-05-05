import { prisma } from "@/lib/prisma";

export type ToggleLikeResult = {
  liked: boolean;
  count: number;
};

/**
 * Toggle a subscriber's like on a post.
 *
 * Sequential awaits (no $transaction): Supabase via pgbouncer in
 * transaction-pool mode times out on multi-statement transactions —
 * see CLAUDE.md gotcha. Worst-case drift on concurrent toggle by ≤1;
 * the admin "Reconcile engagement counts" button corrects it.
 */
export async function toggleLike(
  postId: string,
  subscriberId: string
): Promise<ToggleLikeResult> {
  const existing = await prisma.postLike.findUnique({
    where: { postId_subscriberId: { postId, subscriberId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
  } else {
    await prisma.postLike.create({ data: { postId, subscriberId } });
  }

  const count = await prisma.postLike.count({ where: { postId } });
  await prisma.post.update({ where: { id: postId }, data: { likeCount: count } });

  return { liked: !existing, count };
}

export async function getLikedPostIds(
  subscriberId: string,
  postIds: string[]
): Promise<string[]> {
  if (postIds.length === 0) return [];
  const rows = await prisma.postLike.findMany({
    where: { subscriberId, postId: { in: postIds } },
    select: { postId: true },
  });
  return rows.map((r) => r.postId);
}
