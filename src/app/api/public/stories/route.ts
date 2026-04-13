// src/app/api/public/stories/route.ts
import { NextRequest } from "next/server";
import { getPublicStoriesPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cursorDate = await searchParams.get("cursorDate");
  const cursorId = await searchParams.get("cursorId");

  const cursor =
    cursorDate && cursorId
      ? { date: new Date(cursorDate), id: cursorId }
      : undefined;

  const { stories, nextCursor } = await getPublicStoriesPage(cursor);

  const storiesWithUrls = await Promise.all(
    stories.map(async (s) => ({
      id: s.id,
      originalDate: s.originalDate,
      media: await Promise.all(
        s.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  return Response.json({ stories: storiesWithUrls, nextCursor });
}
