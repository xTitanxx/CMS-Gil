import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { isOurBlobUrl } from "@/lib/url-allowlist";
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

  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: session.user.id },
  });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  let buffer: Buffer;
  let filename: string;
  let mimeType: string;

  if (contentType.includes("application/json")) {
    // Large file: client uploaded to Vercel Blob, sends us the URL
    const body = await req.json();
    filename = body.filename as string;
    mimeType = body.mimeType as string;

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    const blobUrl = body.blobUrl as string;
    if (!isOurBlobUrl(blobUrl)) {
      return NextResponse.json({ error: "Invalid blob URL" }, { status: 400 });
    }
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch file from blob storage" }, { status: 500 });
    }
    buffer = Buffer.from(await response.arrayBuffer());
    await del(blobUrl).catch(() => {});
  } else {
    // Small file: sent directly as multipart/form-data
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    filename = file.name;
    mimeType = file.type;

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    buffer = Buffer.from(await file.arrayBuffer());
  }

  const pathname = mediaKey(session.user.id, filename);
  const { url: storageKey, hasAudio } = await uploadBuffer(pathname, buffer, {
    contentType: mimeType,
  });

  let posterKey: string | null = null;
  if (mimeType.startsWith("video/")) {
    try {
      const { extractPoster } = await import("@/lib/video-processing");
      const posterBuffer = await extractPoster(buffer);
      const posterPath = pathname.replace(/\.[^/.]+$/, "") + ".poster.jpg";
      const posterResult = await uploadBuffer(posterPath, posterBuffer, {
        contentType: "image/jpeg",
      });
      posterKey = posterResult.url;
    } catch (err) {
      console.error("Poster extraction failed:", err);
    }
  }

  const media = await prisma.media.create({
    data: {
      postId,
      storageKey,
      mimeType,
      sizeBytes: buffer.length,
      hasAudio,
    },
  });

  return NextResponse.json(media, { status: 201 });
}
