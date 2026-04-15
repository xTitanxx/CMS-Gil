import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, getThumbnailUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  const userId = session.user.id;

  const unrated = await prisma.post.findMany({
    where: { userId, readiness: "READY", rating: null },
    include: { media: true, rating: true },
    take: limit,
    orderBy: { originalDate: "desc" },
  });
  if (unrated.length >= limit) {
    const items = await Promise.all(
      unrated.map(async (p) => ({
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
    return NextResponse.json({ items });
  }

  const sixMo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const stale = await prisma.post.findMany({
    where: {
      userId,
      readiness: "READY",
      rating: { is: { updatedAt: { lt: sixMo } } },
    },
    include: { media: true, rating: true },
    take: limit - unrated.length,
    orderBy: { originalDate: "desc" },
  });

  const combined = [...unrated, ...stale];
  const items = await Promise.all(
    combined.map(async (p) => ({
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

  return NextResponse.json({ items });
}
