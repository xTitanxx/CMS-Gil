import { prisma } from "@/lib/prisma";

export type ToggleBookmarkResult = {
  bookmarked: boolean;
};

export async function toggleBookmark(
  postId: string,
  subscriberId: string
): Promise<ToggleBookmarkResult> {
  const existing = await prisma.postBookmark.findUnique({
    where: { postId_subscriberId: { postId, subscriberId } },
    select: { id: true },
  });

  if (existing) {
    await prisma.postBookmark.delete({ where: { id: existing.id } });
    return { bookmarked: false };
  }

  await prisma.postBookmark.create({ data: { postId, subscriberId } });
  return { bookmarked: true };
}

export async function getBookmarkedPostIds(
  subscriberId: string,
  postIds: string[]
): Promise<string[]> {
  if (postIds.length === 0) return [];
  const rows = await prisma.postBookmark.findMany({
    where: { subscriberId, postId: { in: postIds } },
    select: { postId: true },
  });
  return rows.map((r) => r.postId);
}
