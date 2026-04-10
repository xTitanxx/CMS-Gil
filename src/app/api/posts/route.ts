import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getThumbnailUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "1");
  const limit = Number(searchParams.get("limit") ?? "20");
  const search = searchParams.get("search") ?? "";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const sort = searchParams.get("sort") ?? "originalDate_desc";
  const tagsParam = searchParams.get("tags"); // comma-separated tag list (OR match)
  // Audio filter: "all" (default) | "audible" | "silent" | "hide-silent"
  //   silent      = every video media has hasAudio=false AND post has ≥1 video
  //   audible     = post has ≥1 video media with hasAudio=true
  //   hide-silent = exclude posts where every video media is silent (i.e. keep
  //                 posts with at least one audible video OR no videos at all)
  const audio = searchParams.get("audio") ?? "all";

  const sortMap: Record<string, { field: string; dir: "asc" | "desc" }> = {
    originalDate_desc: { field: "originalDate", dir: "desc" },
    originalDate_asc:  { field: "originalDate", dir: "asc" },
    createdAt_desc:    { field: "createdAt",    dir: "desc" },
    createdAt_asc:     { field: "createdAt",    dir: "asc" },
  };
  const { field: sortField, dir: sortDir } = sortMap[sort] ?? sortMap["originalDate_desc"];
  const skip = (page - 1) * limit;

  const tagList = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];

  // Build the audio-filter clause. Key definitions:
  //   "silent"      = the post has ≥1 video Media AND every video Media on it
  //                   has hasAudio=false. Matches the common "I posted a muted
  //                   video and didn't notice" case. A post with one silent
  //                   clip and one audible clip is considered audible.
  //   "audible"     = the post has ≥1 video Media with hasAudio=true.
  //   "hide-silent" = not silent (i.e. anything that's not an all-silent-video
  //                   post; posts with no videos pass through).
  // Rows with hasAudio=null are treated as unknown and don't contribute to
  // "silent" classification (so un-backfilled videos won't be flagged).
  let audioClause: Record<string, unknown> = {};
  if (audio === "silent") {
    audioClause = {
      media: {
        some: { mimeType: { startsWith: "video/" }, hasAudio: false },
      },
      AND: [
        {
          media: {
            none: { mimeType: { startsWith: "video/" }, hasAudio: true },
          },
        },
      ],
    };
  } else if (audio === "audible") {
    audioClause = {
      media: {
        some: { mimeType: { startsWith: "video/" }, hasAudio: true },
      },
    };
  } else if (audio === "hide-silent") {
    audioClause = {
      NOT: {
        AND: [
          {
            media: {
              some: { mimeType: { startsWith: "video/" }, hasAudio: false },
            },
          },
          {
            media: {
              none: { mimeType: { startsWith: "video/" }, hasAudio: true },
            },
          },
        ],
      },
    };
  }

  const where = {
    userId: session.user.id,
    ...(search
      ? {
          OR: [
            { body: { contains: search, mode: "insensitive" as const } },
            { tags: { has: search.toLowerCase() } },
          ],
        }
      : {}),
    ...(tagList.length > 0
      ? { tags: { hasSome: tagList } }
      : {}),
    ...(from || to
      ? {
          originalDate: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to ? { lte: new Date(to) } : {}),
          },
        }
      : {}),
    ...audioClause,
  };

  const [total, posts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip,
      take: limit,
      include: {
        media: { select: { id: true, storageKey: true, mimeType: true, hasAudio: true } },
        publishes: {
          select: { platform: true, status: true, platformUrl: true, scheduledAt: true },
        },
        analytics: {
          where: { platform: "FACEBOOK" },
          select: { reactions: true, comments: true, shares: true, platformPostId: true },
        },
      },
    }),
  ]);

  // Add signed URLs for first media of each post, and derive post-level silence:
  // a post is "silent" iff it has ≥1 video Media and every video Media is muted.
  const postsWithUrls = await Promise.all(
    posts.map(async (post) => {
      const firstMedia = post.media[0];
      const thumbUrl = firstMedia
        ? await getThumbnailUrl(firstMedia.storageKey, firstMedia.mimeType).catch(() => null)
        : null;
      const isVideo = firstMedia?.mimeType?.startsWith("video") ?? false;
      const videoMedia = post.media.filter((m) => m.mimeType.startsWith("video/"));
      const isSilent =
        videoMedia.length > 0 && videoMedia.every((m) => m.hasAudio === false);
      return { ...post, thumbUrl, isVideo, isSilent };
    })
  );

  return NextResponse.json({
    posts: postsWithUrls,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const body = await req.json().catch(() => ({}));
  const { ids, all, search } = body as { ids?: string[]; all?: boolean; search?: string };

  if (all) {
    const where = {
      userId,
      ...(search ? {
        OR: [
          { body: { contains: search, mode: "insensitive" as const } },
          { tags: { has: search.toLowerCase() } },
        ],
      } : {}),
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

  const post = await prisma.post.create({
    data: {
      userId: session.user.id,
      body: text.trim(),
      source: "MANUAL",
      originalDate: originalDate ? new Date(originalDate) : new Date(),
    },
  });

  return NextResponse.json(post, { status: 201 });
}
