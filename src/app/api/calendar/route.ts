import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSignedDownloadUrl } from "@/lib/storage";

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end required" }, { status: 400 });
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T23:59:59.999Z`);
  const userId = session.user.id;

  const [publishRecords, importedPosts] = await Promise.all([
    prisma.publishRecord.findMany({
      where: {
        post: { userId },
        OR: [
          { status: "PENDING", scheduledAt: { gte: startDate, lte: endDate } },
          { status: "PUBLISHED", publishedAt: { gte: startDate, lte: endDate } },
        ],
      },
      include: {
        post: { include: { media: { take: 1 } } },
      },
    }),
    prisma.post.findMany({
      where: {
        userId,
        source: "FACEBOOK",
        originalDate: { gte: startDate, lte: endDate },
        publishes: { none: {} },
      },
      include: { media: { take: 1 } },
    }),
  ]);

  const entries = await Promise.all([
    ...publishRecords.map(async (r) => {
      const media = r.post.media[0];
      const thumbUrl = media
        ? await getSignedDownloadUrl(media.storageKey, 3600, media.mimeType).catch(() => null)
        : null;
      const date = r.status === "PUBLISHED" ? r.publishedAt! : r.scheduledAt!;
      return {
        postId: r.postId,
        date: toDateKey(date),
        status: r.status as "PENDING" | "PUBLISHED",
        platform: r.platform as string,
        thumbUrl,
        body: r.post.body,
      };
    }),
    ...importedPosts.map(async (p) => {
      const media = p.media[0];
      const thumbUrl = media
        ? await getSignedDownloadUrl(media.storageKey, 3600, media.mimeType).catch(() => null)
        : null;
      return {
        postId: p.id,
        date: toDateKey(p.originalDate),
        status: "IMPORTED" as const,
        platform: undefined as string | undefined,
        thumbUrl,
        body: p.body,
      };
    }),
  ]);

  return NextResponse.json({ entries });
}
