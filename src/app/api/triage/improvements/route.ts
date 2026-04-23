import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildThumbUrl } from "@/lib/planner/thumbnail";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const PAGE = 20;

  const posts = await prisma.post.findMany({
    where: {
      userId: session.user.id,
      captionSuggestion: { not: null },
    },
    orderBy: [{ captionQuality: "asc" }, { captionAnalyzedAt: "desc" }, { id: "asc" }],
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      body: true,
      captionSuggestion: true,
      captionQuality: true,
      captionEvergreen: true,
      tags: true,
      media: {
        orderBy: { id: "asc" },
        take: 1,
        select: { storageKey: true, mimeType: true },
      },
    },
  });

  const hasNext = posts.length > PAGE;
  const items = posts.slice(0, PAGE).map((p) => ({
    postId: p.id,
    body: p.body,
    suggestion: p.captionSuggestion,
    quality: p.captionQuality,
    evergreen: p.captionEvergreen,
    tags: p.tags,
    thumbUrl: buildThumbUrl(p.media[0]?.storageKey, p.media[0]?.mimeType),
  }));
  const nextCursor = hasNext ? posts[PAGE - 1].id : null;

  // total count — cheap enough on a filtered subset
  const total = await prisma.post.count({
    where: { userId: session.user.id, captionSuggestion: { not: null } },
  });

  return NextResponse.json({ items, nextCursor, total });
}
