import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

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

  const sortMap: Record<string, { field: string; dir: "asc" | "desc" }> = {
    originalDate_desc: { field: "originalDate", dir: "desc" },
    originalDate_asc:  { field: "originalDate", dir: "asc" },
    createdAt_desc:    { field: "createdAt",    dir: "desc" },
    createdAt_asc:     { field: "createdAt",    dir: "asc" },
  };
  const { field: sortField, dir: sortDir } = sortMap[sort] ?? sortMap["originalDate_desc"];
  const skip = (page - 1) * limit;

  const tagList = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : [];

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
  };

  const [total, posts] = await Promise.all([
    prisma.post.count({ where }),
    prisma.post.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip,
      take: limit,
      include: {
        media: { select: { id: true, storageKey: true, mimeType: true } },
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

  // Add signed URLs for first media of each post
  const postsWithUrls = await Promise.all(
    posts.map(async (post) => {
      const firstMedia = post.media[0];
      const thumbUrl = firstMedia
        ? await getSignedDownloadUrl(firstMedia.storageKey, 3600, firstMedia.mimeType).catch(() => null)
        : null;
      return { ...post, thumbUrl };
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
