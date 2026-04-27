// src/app/api/public/stories/route.ts
import { NextRequest } from "next/server";
import { getPublicStoriesPage } from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";

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
          hasAudio: m.hasAudio,
          // audioTrackId is derived from the included relation in public-posts.ts
          // (audioTrack: { storageKey } | null) — surface a stable boolean-ish id
          // for the chat/badge layer without leaking the private audio storage URL.
          audioTrackId: m.audioTrack?.storageKey ? m.id : null,
          url: await getMediaUrl(m).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  return Response.json({ stories: storiesWithUrls, nextCursor });
}
