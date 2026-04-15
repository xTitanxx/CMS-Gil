import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, getThumbnailUrl } from "@/lib/storage";
import { parsePostTypeFilter, postTypeWhere } from "@/lib/post-type-filter";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket");
  const cursor = url.searchParams.get("cursor");
  const type = parsePostTypeFilter(url.searchParams.get("type"));

  const where = {
    userId: session.user.id,
    readiness: "NOT_READY" as const,
    ...(bucket ? { notReadyReasons: { has: bucket } } : {}),
    ...postTypeWhere(type),
  };

  const posts = await prisma.post.findMany({
    where,
    include: { media: { include: { audioTrack: true } }, rating: true },
    orderBy: { originalDate: "desc" },
    take: 21,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const hasMore = posts.length > 20;
  const page = posts.slice(0, 20);

  const items = await Promise.all(
    page.map(async (p) => ({
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

  return NextResponse.json({
    items,
    nextCursor: hasMore ? page[19].id : null,
  });
}
