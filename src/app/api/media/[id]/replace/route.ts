// POST /api/media/[id]/replace
// Replaces the underlying file for an existing media record.
// Accepts the same two upload modes as POST /api/posts/[id]/media:
//   - multipart/form-data with a "file" field (small files, ≤4 MB)
//   - application/json with { key, filename, mimeType } (large files: client
//     PUT directly to R2 via /api/media/[id]/replace/presign)
// On success returns { id, storageKey, mimeType, sizeBytes, hasAudio }.
import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  uploadBuffer,
  mediaKey,
  getObject,
  deleteObject,
  r2UrlForKey,
} from "@/lib/storage";
import { refreshReadiness } from "@/lib/readiness-service";
import { detectMimeType } from "@/lib/magic-byte";
import { probeHasAudio } from "@/lib/video-processing";

// Match POST /api/posts/[id]/media — large iPhone videos can trip the
// platform default while the after() chain (compress + poster) settles.
export const maxDuration = 300;

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
  let pathname: string;
  let alreadyInR2 = false;

  if (contentType.includes("application/json")) {
    const body = await req.json();
    const key = typeof body.key === "string" ? body.key : "";

    // Lock the key to this user's media prefix. Without this, the JSON body
    // could point at any object in R2 and we'd overwrite this media row
    // with someone else's file.
    const userPrefix = `media/${session.user.id}/`;
    if (!key.startsWith(userPrefix)) {
      return NextResponse.json({ error: "Invalid storage key" }, { status: 400 });
    }

    pathname = key;
    alreadyInR2 = true;
    try {
      buffer = await getObject(r2UrlForKey(key));
    } catch (err) {
      console.error(
        "[api/media/[id]/replace] failed to fetch presigned object",
        err
      );
      return NextResponse.json(
        { error: "Failed to fetch uploaded file" },
        { status: 500 }
      );
    }
  } else {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    buffer = Buffer.from(await file.arrayBuffer());
    pathname = mediaKey(session.user.id, file.name);
  }

  // Sniff actual content; ignore client-asserted Content-Type / extension.
  const detected = detectMimeType(buffer);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
    if (alreadyInR2) {
      await deleteObject(r2UrlForKey(pathname));
    }
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }
  const mimeType = detected;

  let storageKey: string;
  let hasAudio: boolean | null = null;
  if (alreadyInR2) {
    storageKey = r2UrlForKey(pathname);
    if (mimeType.startsWith("video/")) {
      try {
        hasAudio = await probeHasAudio(buffer);
      } catch (err) {
        console.warn("Audio probe failed, defaulting to null:", err);
      }
    }
  } else {
    const uploaded = await uploadBuffer(pathname, buffer, { contentType: mimeType });
    storageKey = uploaded.url;
    hasAudio = uploaded.hasAudio;
  }

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

  if (mimeType.startsWith("video/")) {
    // Compress + extract poster off the new file. Same pattern as
    // POST /api/posts/[id]/media — work happens post-response; failures
    // leave the original in R2 for a backfill to retry.
    const replacedMediaId = updated.id;
    const finalKey = pathname;
    after(async () => {
      let workingBuffer = buffer;
      try {
        const { compressVideo } = await import("@/lib/video-processing");
        const compressed = await compressVideo(buffer);
        if (compressed !== buffer && compressed.length < buffer.length) {
          await uploadBuffer(finalKey, compressed, { contentType: mimeType });
          await prisma.media.update({
            where: { id: replacedMediaId },
            data: { sizeBytes: compressed.length },
          });
          workingBuffer = compressed;
        }
      } catch (err) {
        console.error(
          `[compress] FAILED for ${finalKey}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }

      try {
        const { extractPoster } = await import("@/lib/video-processing");
        const posterBuffer = await extractPoster(workingBuffer);
        const posterPath = finalKey.replace(/\.[^/.]+$/, "") + ".poster.jpg";
        await uploadBuffer(posterPath, posterBuffer, { contentType: "image/jpeg" });
      } catch (err) {
        console.error(
          `[posters] FAILED to generate poster for ${finalKey}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    });
  }

  return NextResponse.json(updated);
}
