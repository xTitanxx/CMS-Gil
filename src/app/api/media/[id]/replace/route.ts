// POST /api/media/[id]/replace
// Replaces the underlying file for an existing media record.
// Accepts the same two upload modes as POST /api/posts/[id]/media:
//   - multipart/form-data with a "file" field (small files, ≤4 MB)
//   - application/json with { blobUrl, filename, mimeType } (large files via Vercel Blob staging)
// On success returns { id, storageKey, mimeType, sizeBytes, hasAudio }.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { refreshReadiness } from "@/lib/readiness-service";
import { isOurBlobUrl } from "@/lib/url-allowlist";
import { detectMimeType } from "@/lib/magic-byte";
import { del } from "@vercel/blob";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: mediaId } = await params;

  const existing = await prisma.media.findUnique({
    where: { id: mediaId },
    include: { post: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.post.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let buffer: Buffer;
  let filename: string;
  let mimeType: string;

  if (contentType.includes("application/json")) {
    const body = await req.json();
    filename = body.filename as string;
    const blobUrl = body.blobUrl as string;
    if (!isOurBlobUrl(blobUrl)) {
      return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
    }
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch from blob storage" }, { status: 500 });
    }
    buffer = Buffer.from(await response.arrayBuffer());
    await del(blobUrl).catch(() => {});
  } else {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    filename = file.name;
    buffer = Buffer.from(await file.arrayBuffer());
  }

  // Sniff actual content; ignore client-asserted Content-Type / extension.
  const detected = detectMimeType(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  mimeType = detected;

  const key = mediaKey(session.user.id, filename);
  const { url: storageKey, hasAudio } = await uploadBuffer(key, buffer, { contentType: mimeType });

  const updated = await prisma.media.update({
    where: { id: mediaId },
    data: {
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
      hasAudio,
      width: null,
      height: null,
    },
  });

  await refreshReadiness(existing.postId);

  return NextResponse.json(updated);
}
