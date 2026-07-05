import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { preparePublishKeys, type MediaForPublish } from "@/lib/publish-prep";
import { getObject, uploadBuffer, mediaKey } from "@/lib/storage";
import { remuxToMp4 } from "@/lib/video-processing";

type ShareMediaRow = MediaForPublish & { id: string };

// Same "does this need a music mux" check preparePublishKeys uses
// internally — needed here too so we know which of its returned URLs are
// already guaranteed mp4 (from the mux step) vs. untouched originals.
function needsMux(m: ShareMediaRow): boolean {
  return (
    m.mimeType.startsWith("video/") && m.hasAudio === false && !!m.audioTrack?.storageKey
  );
}

/**
 * Mux-and-remux-aware media URLs for the Facebook-personal share flow
 * (compose page's retry banner). Two transformations, both server-side
 * since neither can happen in the browser:
 *  - Bakes an attached AudioTrack onto a silent video (reusing the same
 *    preparePublishKeys() step the automated publish path already uses) —
 *    without it, a post's music would only ever show up in the in-app
 *    preview, never in what actually gets shared to Facebook.
 *  - Remuxes any video that isn't already a genuine MP4 (most commonly an
 *    iPhone .mov) into one. Relabeling a file's declared type client-side
 *    isn't enough — Facebook/WhatsApp's share handling (and various
 *    browsers) sniff the actual container bytes and still treat a
 *    relabeled-but-still-QuickTime file as non-video.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }
  const { id } = await params;

  const post = await prisma.post.findFirst({
    where: { id, userId: session.user.id },
    select: {
      media: {
        select: {
          id: true,
          mimeType: true,
          storageKey: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });

  const urls = await preparePublishKeys(session.user.id, post.media);

  const media = await Promise.all(
    post.media.map(async (m, i) => {
      if (needsMux(m)) {
        // preparePublishKeys already muxed this one and its output is
        // always a genuine mp4 (see publish-prep.ts).
        return { id: m.id, mimeType: "video/mp4", url: urls[i] };
      }
      if (m.mimeType.startsWith("video/") && m.mimeType !== "video/mp4") {
        const videoBuffer = await getObject(urls[i]);
        const remuxed = await remuxToMp4(videoBuffer);
        const key = mediaKey(session.user.id, `remuxed-${Date.now()}.mp4`);
        const { url } = await uploadBuffer(key, remuxed, { contentType: "video/mp4" });
        return { id: m.id, mimeType: "video/mp4", url };
      }
      return { id: m.id, mimeType: m.mimeType, url: urls[i] };
    }),
  );

  return NextResponse.json({ media });
}
