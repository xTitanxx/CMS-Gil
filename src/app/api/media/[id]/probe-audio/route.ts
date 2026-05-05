// src/app/api/media/[id]/probe-audio/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchVideoAudioStatus } from "@/lib/storage";
import { refreshReadiness } from "@/lib/readiness-service";
import { isOurR2Url } from "@/lib/url-allowlist";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const { id } = await params;

  const media = await prisma.media.findUnique({ where: { id }, include: { post: true } });
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (media.post.userId !== session.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // SSRF guard: fetchVideoAudioStatus issues a fetch against the URL.
  if (!isOurR2Url(media.storageKey)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const hasAudio = await fetchVideoAudioStatus(media.storageKey);
  await prisma.media.update({ where: { id }, data: { hasAudio } });
  await refreshReadiness(media.postId);

  return NextResponse.json({ hasAudio });
}
