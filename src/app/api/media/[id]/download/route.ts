import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOurR2Url } from "@/lib/url-allowlist";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const media = await prisma.media.findUnique({
    where: { id },
    include: { post: true },
  });
  if (!media || media.post.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // SSRF guard: this route streams the upstream body back to the caller, so
  // we only proxy URLs that we wrote ourselves. Defense in depth — even
  // though /api/media/[id] PATCH now validates storageKey on write, legacy
  // rows could in theory hold a non-R2 URL.
  if (!isOurR2Url(media.storageKey)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const upstream = await fetch(media.storageKey);
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Upstream fetch failed" }, { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": media.mimeType,
    "Content-Disposition": "attachment",
    "Cache-Control": "no-store",
  });
  const len = upstream.headers.get("content-length");
  if (len) headers.set("Content-Length", len);

  return new NextResponse(upstream.body, { status: 200, headers });
}
