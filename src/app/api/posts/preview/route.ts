import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";

export async function GET(req: NextRequest) {
  // Gated behind any session (admin or subscriber). Otherwise unauthenticated
  // visitors could enumerate the READY archive even when PUBLIC_GATE_ENABLED
  // is meant to be airtight.
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idsParam = req.nextUrl.searchParams.get("ids");
  if (!idsParam) {
    return Response.json({ error: "ids parameter required" }, { status: 400 });
  }

  const ids = idsParam.split(",").slice(0, 3);

  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) {
    return Response.json({ error: "Not configured" }, { status: 500 });
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: ids }, userId: gilUserId, readiness: "READY" },
    select: {
      id: true,
      body: true,
      originalDate: true,
      tags: true,
      platformUrl: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
        take: 1,
      },
    },
  });

  const result = await Promise.all(
    posts.map(async (p) => {
      const firstMedia = p.media[0];
      let mediaUrl: string | null = null;
      let mediaMimeType: string | null = null;

      if (firstMedia) {
        try {
          mediaUrl = await getMediaUrl(firstMedia);
        } catch {
          mediaUrl = null;
        }
        mediaMimeType = firstMedia.mimeType;
      }

      return {
        id: p.id,
        body: p.body,
        originalDate: p.originalDate,
        tags: p.tags,
        platformUrl: p.platformUrl,
        mediaUrl,
        mediaMimeType,
        mediaWidth: firstMedia?.width ?? null,
        mediaHeight: firstMedia?.height ?? null,
        mediaAltText: firstMedia?.altText ?? null,
        hasAudio: firstMedia?.hasAudio ?? null,
        // Stable id for the badge layer when an AudioTrack is attached;
        // we don't leak the audio storage URL itself to the public chat.
        audioTrackId: firstMedia?.audioTrack?.storageKey ? firstMedia.id : null,
      };
    })
  );

  // Now that this endpoint requires a session, the response can't be a
  // public-cacheable artifact — Vercel's edge cache would otherwise serve
  // it to subsequent unauthenticated requests.
  return Response.json(result, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
