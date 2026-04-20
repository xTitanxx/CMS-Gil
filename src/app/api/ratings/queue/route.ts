import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, getThumbnailUrl } from "@/lib/storage";
import { parsePostTypeFilter, postTypeWhere } from "@/lib/post-type-filter";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 20);
  const type = parsePostTypeFilter(url.searchParams.get("type"));
  const typeWhere = postTypeWhere(type);
  const userId = session.user.id;
  const mode = url.searchParams.get("mode");

  if (mode === "purge") {
    return purgeQueue(userId, limit, typeWhere);
  }

  // --- Original rating queue logic ---
  const unratedCount = await prisma.post.count({
    where: { userId, readiness: "READY", rating: null, ...typeWhere },
  });
  const maxSkip = Math.max(0, unratedCount - limit);
  const skip = maxSkip > 0 ? Math.floor(Math.random() * maxSkip) : 0;

  const unrated = await prisma.post.findMany({
    where: { userId, readiness: "READY", rating: null, ...typeWhere },
    include: { media: true, rating: true },
    take: limit,
    skip,
    orderBy: { originalDate: "desc" },
  });

  let posts = unrated;
  if (unrated.length < limit) {
    const sixMo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const stale = await prisma.post.findMany({
      where: {
        userId,
        readiness: "READY",
        rating: { is: { updatedAt: { lt: sixMo } } },
        ...typeWhere,
      },
      include: { media: true, rating: true },
      take: limit - unrated.length,
      orderBy: { originalDate: "desc" },
    });
    posts = [...unrated, ...stale];
  }

  const items = await Promise.all(
    posts.map(async (p) => ({
      ...p,
      media: await Promise.all(
        p.media.map(async (m) => ({
          ...m,
          url: await getMediaUrl(m).catch(() => null),
          thumbnailUrl: await getThumbnailUrl(m.storageKey, m.mimeType).catch(() => null),
        }))
      ),
    }))
  );

  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return NextResponse.json({ items });
}

async function purgeQueue(
  userId: string,
  limit: number,
  typeWhere: Record<string, unknown>,
) {
  // Prioritize UNCHECKED first, then NOT_READY, then READY
  const posts = await prisma.post.findMany({
    where: { userId, readiness: { not: "ARCHIVED" }, ...typeWhere },
    include: {
      media: true,
      rating: true,
      analytics: { take: 1, orderBy: { fetchedAt: "desc" } },
    },
    take: limit,
    orderBy: [{ originalDate: "desc" }],
  });

  // Sort: UNCHECKED first, then NOT_READY, then READY
  const order: Record<string, number> = { UNCHECKED: 0, NOT_READY: 1, READY: 2 };
  posts.sort(
    (a, b) => (order[a.readiness] ?? 3) - (order[b.readiness] ?? 3),
  );

  const items = await Promise.all(
    posts.map(async (p) => {
      const a = p.analytics[0] ?? null;
      return {
        ...p,
        analytics: a
          ? {
              reactions: a.reactions,
              comments: a.comments,
              shares: a.shares,
              reach: a.reach,
              impressions: a.impressions,
              platform: a.platform,
            }
          : null,
        media: await Promise.all(
          p.media.map(async (m) => ({
            ...m,
            url: await getMediaUrl(m).catch(() => null),
            thumbnailUrl: await getThumbnailUrl(m.storageKey, m.mimeType).catch(() => null),
          }))
        ),
      };
    })
  );

  // Count totals for progress
  const [total, archived] = await Promise.all([
    prisma.post.count({ where: { userId } }),
    prisma.post.count({ where: { userId, readiness: "ARCHIVED" } }),
  ]);

  return NextResponse.json({
    items,
    purgeStats: { total, archived, remaining: total - archived },
  });
}
