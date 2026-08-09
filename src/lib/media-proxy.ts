import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOurR2Url } from "@/lib/url-allowlist";

type MediaVariant = "content" | "poster";

const FORWARDED_REQUEST_HEADERS = [
  "range",
  "if-none-match",
  "if-modified-since",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
  "last-modified",
] as const;

function posterUrlForStorage(storageKey: string): string {
  return storageKey.replace(/\.[^/.]+$/, ".poster.jpg");
}

export async function proxyMediaRequest(
  request: Request,
  mediaId: string,
  variant: MediaVariant,
): Promise<Response> {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: {
      storageKey: true,
      mimeType: true,
      post: { select: { userId: true } },
    },
  });
  if (!media || !isOurR2Url(media.storageKey)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const gilUserId = process.env.GIL_USER_ID;
  const isPublic = !!gilUserId && media.post.userId === gilUserId;
  if (!isPublic) {
    const session = await auth();
    if (!session?.user?.id || session.user.id !== media.post.userId) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
  }

  const upstreamUrl = variant === "poster"
    ? posterUrlForStorage(media.storageKey)
    : media.storageKey;
  if (!isOurR2Url(upstreamUrl)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const upstreamHeaders = new Headers({ "accept-encoding": "identity" });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) upstreamHeaders.set(name, value);
  }

  const upstream = await fetch(upstreamUrl, {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers: upstreamHeaders,
    cache: "no-store",
  });
  if (!upstream.ok && upstream.status !== 304 && upstream.status !== 416) {
    const status = upstream.status === 404 ? 404 : 502;
    return Response.json({ error: "Media unavailable" }, { status });
  }

  const headers = new Headers({
    "Content-Type": variant === "poster"
      ? "image/jpeg"
      : upstream.headers.get("content-type") ?? media.mimeType,
    "Content-Disposition": "inline",
    "Cache-Control": isPublic
      ? "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"
      : "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
