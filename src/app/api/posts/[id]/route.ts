import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl, deleteObject } from "@/lib/storage";
import { normalizeForSearch } from "@/lib/search-normalize";

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
      media: true,
      publishes: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!post) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const mediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      ...m,
      url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(() => null),
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
    },
  });

  if (post.count === 0)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

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
    await deleteObject(m.storageKey, m.mimeType).catch(() => {});
  }

  await prisma.post.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
