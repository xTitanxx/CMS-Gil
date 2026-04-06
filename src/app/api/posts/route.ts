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
  const skip = (page - 1) * limit;

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
      orderBy: { originalDate: "desc" },
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
