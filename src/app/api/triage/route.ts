import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaThumbnailUrl, getMediaUrl } from "@/lib/storage";
import {
  buildCursorClause,
  buildPostsQuery,
  cursorFromRow,
  decodeCursor,
  encodeCursor,
  parsePostsFilters,
} from "@/lib/posts-query";
import type { Prisma } from "@prisma/client";

const POST_INCLUDE = {
  media: {
    include: { audioTrack: true },
  },
  publishes: {
    select: {
      platform: true,
      status: true,
      platformUrl: true,
      scheduledAt: true,
    },
  },
  rating: true,
  analytics: {
    select: { platform: true, reactions: true, comments: true, shares: true },
  },
} as const;

type PostWithIncludes = Awaited<
  ReturnType<typeof prisma.post.findMany<{ include: typeof POST_INCLUDE }>>
>[number];

async function decoratePosts(posts: PostWithIncludes[]) {
  return Promise.all(
    posts.map(async (post) => {
      const firstMedia = post.media[0];
      const thumbUrl = firstMedia
        ? await getMediaThumbnailUrl(firstMedia).catch(() => null)
        : null;
      const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;
      const videoMedia = post.media.filter((m) => m.mimeType.startsWith("video/"));
      const isSilent =
        videoMedia.length > 0 && videoMedia.every((m) => m.hasAudio === false);
      const videoUrl = isVideo && firstMedia
        ? await getMediaUrl(firstMedia).catch(() => null)
        : null;
      const mediaWithUrls = await Promise.all(
        post.media.map(async (m) => ({
          ...m,
          url: await getMediaUrl(m).catch(() => null),
          thumbnailUrl: await getMediaThumbnailUrl(m).catch(() => null),
        })),
      );
      return { ...post, media: mediaWithUrls, thumbUrl, videoUrl, isVideo, isSilent };
    }),
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { searchParams } = new URL(req.url);
    const limit = Number(searchParams.get("limit") ?? "20");
    const cursorParam = searchParams.get("cursor");
    const cursor = decodeCursor(cursorParam);
    const bucket = searchParams.get("bucket");
    const view = searchParams.get("view");

    if (view === "approved") {
      return handleApprovedView(userId, limit, cursorParam);
    }

    const filters = parsePostsFilters(searchParams);

    const readinessExtras: Prisma.PostWhereInput[] = [
      { readiness: "NOT_READY" },
    ];
    if (bucket) {
      readinessExtras.push({ notReadyReasons: { has: bucket } });
    }

    const { where: baseWhere, orderBy } = buildPostsQuery(
      filters,
      userId,
      { extraWhere: readinessExtras },
    );

    if (cursor) {
      const cursorClause = buildCursorClause(filters.sort, cursor);
      const where = { AND: [baseWhere, cursorClause] };
      const rows = await prisma.post.findMany({
        where,
        orderBy,
        take: limit,
        include: POST_INCLUDE,
      });
      const decorated = await decoratePosts(rows);
      const nextCursor =
        rows.length === limit
          ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
          : null;
      return NextResponse.json({ posts: decorated, nextCursor });
    }

    const subKindSpecs: Array<{ key: string; kind: "posts" | "stories"; sub: string }> = [
      { key: "postsAll", kind: "posts", sub: "all" },
      { key: "postsVideoAudio", kind: "posts", sub: "video-audio" },
      { key: "postsVideoSilent", kind: "posts", sub: "video-silent" },
      { key: "postsPhoto", kind: "posts", sub: "photo" },
      { key: "postsText", kind: "posts", sub: "text" },
      { key: "postsQuoted", kind: "posts", sub: "quoted" },
      { key: "storiesAll", kind: "stories", sub: "all" },
      { key: "storiesVideoAudio", kind: "stories", sub: "video-audio" },
      { key: "storiesVideoSilent", kind: "stories", sub: "video-silent" },
    ];

    const { where: kindOnlyWhere } = buildPostsQuery(
      { ...filters, subKind: undefined },
      userId,
      { extraWhere: readinessExtras },
    );

    const [total, filteredTotal, rows, ...subCounts] = await Promise.all([
      prisma.post.count({ where: kindOnlyWhere }),
      prisma.post.count({ where: baseWhere }),
      prisma.post.findMany({
        where: baseWhere,
        orderBy,
        take: limit,
        include: POST_INCLUDE,
      }),
      ...subKindSpecs.map((spec) => {
        const { where } = buildPostsQuery(
          { ...filters, kind: spec.kind, subKind: spec.sub },
          userId,
          { extraWhere: readinessExtras },
        );
        return prisma.post.count({ where });
      }),
    ]);

    const subKindCounts = Object.fromEntries(
      subKindSpecs.map((spec, i) => [spec.key, subCounts[i] ?? 0]),
    ) as Record<string, number>;
    const postsCount = subKindCounts.postsAll ?? 0;
    const storiesCount = subKindCounts.storiesAll ?? 0;

    const decorated = await decoratePosts(rows);
    const nextCursor =
      rows.length === limit
        ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
        : null;

    return NextResponse.json({
      posts: decorated,
      total,
      filteredTotal,
      nextCursor,
      kindCounts: { posts: postsCount, stories: storiesCount },
      subKindCounts,
    });
  } catch (err) {
    console.error("[GET /api/triage] DB error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable", posts: [], total: 0 },
      { status: 503 },
    );
  }
}

// Approved subtab: posts the user manually marked ready via Triage, sorted by
// when they were approved (most recent first). Uses a simple offset cursor
// because triageApprovedAt isn't a column the generic cursor machinery in
// posts-query knows about, and the list is naturally bounded.
async function handleApprovedView(
  userId: string,
  limit: number,
  cursorParam: string | null,
) {
  const offset = cursorParam ? Math.max(0, Number(cursorParam) || 0) : 0;
  const where: Prisma.PostWhereInput = {
    userId,
    triageApprovedAt: { not: null },
  };

  const [total, rows] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: [{ triageApprovedAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: limit,
      include: POST_INCLUDE,
    }),
  ]);

  const decorated = await decoratePosts(rows);
  const nextOffset = offset + rows.length;
  const nextCursor = rows.length === limit && nextOffset < total ? String(nextOffset) : null;

  return NextResponse.json({
    posts: decorated,
    total,
    filteredTotal: total,
    nextCursor,
  });
}
