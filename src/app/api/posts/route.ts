import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThumbnailUrl, getSignedDownloadUrl } from "@/lib/storage";
import { normalizeForSearch } from "@/lib/search-normalize";
import { postAudioState } from "@/lib/post-audio-state";
import { refreshReadiness } from "@/lib/readiness-service";
import {
  buildCursorClause,
  buildPostsQuery,
  cursorFromRow,
  decodeCursor,
  encodeCursor,
  parsePostsFilters,
} from "@/lib/posts-query";

const POST_INCLUDE = {
  media: {
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      hasAudio: true,
      audioTrackId: true,
      width: true,
      height: true,
    },
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

async function getMultiMediaPostIds(
  userId: string,
  mode: "1" | "2",
): Promise<string[]> {
  const rows = mode === "1"
    ? await prisma.$queryRaw<Array<{ postId: string }>>`
        SELECT m."postId"
        FROM "Media" m
        JOIN "Post" p ON p.id = m."postId"
        WHERE p."userId" = ${userId}
        GROUP BY m."postId"
        HAVING COUNT(*) = 1
      `
    : await prisma.$queryRaw<Array<{ postId: string }>>`
        SELECT m."postId"
        FROM "Media" m
        JOIN "Post" p ON p.id = m."postId"
        WHERE p."userId" = ${userId}
        GROUP BY m."postId"
        HAVING COUNT(*) >= 2
      `;
  return rows.map((r) => r.postId);
}

async function decoratePosts(posts: PostWithIncludes[]) {
  return Promise.all(
    posts.map(async (post) => {
      const firstMedia = post.media[0];
      const thumbUrl = firstMedia
        ? await getThumbnailUrl(firstMedia.storageKey, firstMedia.mimeType).catch(
            () => null,
          )
        : null;
      const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;
      const videoMedia = post.media.filter((m) =>
        m.mimeType.startsWith("video/"),
      );
      const isSilent =
        videoMedia.length > 0 && videoMedia.every((m) => m.hasAudio === false);
      // Tri-state for the UI badge: distinguishes silent-with-music-attached
      // (will be muxed at publish time) from silent-bare (will publish muted).
      const audioState = postAudioState(post.media);
      const videoUrl = isVideo && firstMedia
        ? await getSignedDownloadUrl(firstMedia.storageKey).catch(() => null)
        : null;
      return { ...post, thumbUrl, videoUrl, isVideo, isSilent, audioState };
    }),
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "20");
  const cursorParam = searchParams.get("cursor");
  const cursor = decodeCursor(cursorParam);

  const filters = parsePostsFilters(searchParams);
  const postIdAllowlist =
    filters.multiMedia === "2"
      ? await getMultiMediaPostIds(session.user.id, "2")
      : filters.multiMedia === "1"
        ? await getMultiMediaPostIds(session.user.id, "1")
        : null;
  const { where: baseWhere, orderBy } = buildPostsQuery(
    filters,
    session.user.id,
    { postIdAllowlist },
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

  const skip = (page - 1) * limit;
  const userId = session.user.id;

  // Counts for the sub-tab pill row. We compute these with the same base
  // Where shape (search, filters, date range, etc.) but swapped kind+subKind,
  // so switching tabs feels consistent with what the user is currently
  // filtering for.
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

  // Count WITHOUT subKind so "X posts total" reflects the full kind, not just
  // the active sub-tab.  The sub-kind counts below give per-tab numbers.
  const { where: kindOnlyWhere } = buildPostsQuery(
    { ...filters, subKind: undefined },
    userId,
    { postIdAllowlist },
  );

  const [total, filteredTotal, rows, ...subCounts] = await Promise.all([
    prisma.post.count({ where: kindOnlyWhere }),
    prisma.post.count({ where: baseWhere }),
    prisma.post.findMany({
      where: baseWhere,
      orderBy,
      skip,
      take: limit,
      include: POST_INCLUDE,
    }),
    ...subKindSpecs.map((spec) => {
      const { where } = buildPostsQuery(
        { ...filters, kind: spec.kind, subKind: spec.sub },
        userId,
        { postIdAllowlist },
      );
      return prisma.post.count({ where });
    }),
  ]);
  const subKindCounts = Object.fromEntries(
    subKindSpecs.map((spec, i) => [spec.key, subCounts[i] ?? 0]),
  ) as Record<string, number>;
  const postsCount = subKindCounts.postsAll ?? 0;
  const storiesCount = subKindCounts.storiesAll ?? 0;

  // When a filter is active, also compute unfiltered totals per sub-tab
  // so the UI can show "0/81" instead of just "0".
  const hasFilter = !!(filters.search || filters.tags || filters.from || filters.to);
  let subKindTotals: Record<string, number> | undefined;
  if (hasFilter) {
    const noFilterBase = { kind: filters.kind, subKind: undefined } as const;
    const totalCounts = await Promise.all(
      subKindSpecs.map((spec) => {
        const { where } = buildPostsQuery(
          { ...noFilterBase, kind: spec.kind, subKind: spec.sub },
          userId,
        );
        return prisma.post.count({ where });
      }),
    );
    subKindTotals = Object.fromEntries(
      subKindSpecs.map((spec, i) => [spec.key, totalCounts[i] ?? 0]),
    );
  }

  const decorated = await decoratePosts(rows);
  const nextCursor =
    rows.length === limit
      ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
      : null;

  return NextResponse.json({
    posts: decorated,
    total,
    filteredTotal,
    page,
    pages: Math.ceil(filteredTotal / limit),
    nextCursor,
    kindCounts: { posts: postsCount, stories: storiesCount },
    subKindCounts,
    ...(subKindTotals ? { subKindTotals } : {}),
  });
  } catch (err) {
    console.error("[GET /api/posts] DB error:", err);
    return NextResponse.json(
      { error: "Database temporarily unavailable", posts: [], total: 0 },
      { status: 503 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const { ids, all, search } = body as {
    ids?: string[];
    all?: boolean;
    search?: string;
  };

  if (all) {
    const where = {
      userId,
      ...(search
        ? {
            OR: [
              { bodyNormalized: { contains: normalizeForSearch(search) } },
              { tags: { has: search.toLowerCase() } },
            ],
          }
        : {}),
    };
    const { count } = await prisma.post.deleteMany({ where });
    return NextResponse.json({ deleted: count });
  }

  if (Array.isArray(ids) && ids.length > 0) {
    const { count } = await prisma.post.deleteMany({
      where: { userId, id: { in: ids } },
    });
    return NextResponse.json({ deleted: count });
  }

  return NextResponse.json({ error: "Provide ids or all:true" }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { text, originalDate } = body;

  if (!text?.trim()) {
    return NextResponse.json({ error: "Post text is required" }, { status: 400 });
  }

  const trimmed = text.trim();
  const post = await prisma.post.create({
    data: {
      userId: session.user.id,
      body: trimmed,
      bodyNormalized: normalizeForSearch(trimmed),
      source: "MANUAL",
      originalDate: originalDate ? new Date(originalDate) : new Date(),
    },
  });

  await refreshReadiness(post.id).catch((e) => console.error("readiness refresh failed", e));

  return NextResponse.json(post, { status: 201 });
}
