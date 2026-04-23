import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getMediaUrl, deleteObject } from "@/lib/storage";
import { normalizeForSearch } from "@/lib/search-normalize";
import { refreshReadiness } from "@/lib/readiness-service";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: {
      media: { include: { audioTrack: { select: { id: true, title: true, storageKey: true } } } },
      publishes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      ...m,
      url: await getMediaUrl(m).catch(() => null),
    }))
  );

  return NextResponse.json({ ...post, media: mediaWithUrls });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const post = await prisma.post.updateMany({
    where: { id, userId: session.user.id },
    data: {
      ...(body.body !== undefined
        ? { body: body.body, bodyNormalized: normalizeForSearch(body.body) }
        : {}),
      ...(body.originalDate !== undefined
        ? { originalDate: new Date(body.originalDate) }
        : {}),
      ...(body.tags !== undefined && Array.isArray(body.tags)
        ? { tags: (body.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 50) }
        : {}),
      ...(body.postType !== undefined &&
        ["POST", "REEL", "STORY"].includes(body.postType)
        ? { postType: body.postType }
        : {}),
      ...(body.share !== undefined
        ? { share: body.share === null ? Prisma.DbNull : body.share }
        : {}),
      ...(body.platformUrl !== undefined
        ? {
            platformUrl:
              typeof body.platformUrl === "string" && body.platformUrl.trim()
                ? body.platformUrl.trim()
                : null,
          }
        : {}),
    },
  });

  if (post.count === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  await refreshReadiness(id).catch((e) => console.error("readiness refresh failed", e));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    include: { media: true },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Delete media from storage
  for (const m of post.media) {
    await deleteObject(m.storageKey).catch(() => {});
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
