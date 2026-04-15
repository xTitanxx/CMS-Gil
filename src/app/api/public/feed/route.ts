import { NextRequest } from "next/server";
import { getPublicFeedPage } from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const searchParams = await req.nextUrl.searchParams;
  const cursorDate = searchParams.get("cursorDate");
  const cursorId = searchParams.get("cursorId");

  const cursor =
    cursorDate && cursorId
      ? { date: new Date(cursorDate), id: cursorId }
      : undefined;

  const { posts, nextCursor } = await getPublicFeedPage(cursor);

  const postsWithMediaUrls = await Promise.all(
    posts.map(async (p) => ({
      id: p.id,
      body: p.body,
      originalDate: p.originalDate,
      tags: p.tags,
      media: await Promise.all(
        p.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          hasAudio: m.hasAudio,
          url: await getMediaUrl(m).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  return Response.json({
    posts: postsWithMediaUrls,
    nextCursor,
  });
}
