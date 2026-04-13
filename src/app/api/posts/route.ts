import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThumbnailUrl, getSignedDownloadUrl } from "@/lib/storage";
import { normalizeForSearch } from "@/lib/search-normalize";
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
    select: { id: true, storageKey: true, mimeType: true, hasAudio: true },
  },
  publishes: {
    select: {
      platform: true,
      status: true,
      platformUrl: true,
      scheduledAt: true,
    },
  },
} as const;

type PostWithIncludes = Awaited<
  ReturnType<typeof prisma.post.findMany<{ include: typeof POST_INCLUDE }>>
>[number];

async function getMultiMediaPostIds(
  userId: string,
  minCount: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ postId: string }>>`
    SELECT m."postId"
    FROM "Media" m
    JOIN "Post" p ON p.id = m."postId"
    WHERE p."userId" = ${userId}
    GROUP BY m."postId"
    HAVING COUNT(*) >= ${minCount}
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
      const videoUrl = isVideo && firstMedia
        ? await getSignedDownloadUrl(
            firstMedia.storageKey,
            undefined,
            firstMedia.mimeType,
          ).catch(() => null)
        : null;
      return { ...post, thumbUrl, videoUrl, isVideo, isSilent };
    }),
  );
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "20");
  const cursorParam = searchParams.get("cursor");
  const cursor = decodeCursor(cursorParam);

  const filters = parsePostsFilters(searchParams);
  const postIdAllowlist =
    filters.multiMedia === "2"
      ? await getMultiMediaPostIds(session.user.id, 2)
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
  const [total, rows] = await Promise.all([
    prisma.post.count({ where: baseWhere }),
    prisma.post.findMany({
      where: baseWhere,
      orderBy,
      skip,
      take: limit,
      include: POST_INCLUDE,
    }),
  ]);

  const decorated = await decoratePosts(rows);
  const nextCursor =
    rows.length === limit
      ? encodeCursor(cursorFromRow(filters.sort, rows[rows.length - 1]))
      : null;

  return NextResponse.json({
    posts: decorated,
    total,
    page,
    pages: Math.ceil(total / limit),
    nextCursor,
  });
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

  return NextResponse.json(post, { status: 201 });
}
