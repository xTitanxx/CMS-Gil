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
import { detectMimeType } from "@/lib/magic-byte";
import { probeHasAudio } from "@/lib/video-processing";

// 55-second iPhone videos run 50-150MB. The synchronous chain (R2 fetch +
// ffprobe audio + ffmpeg poster) was tripping the platform default timeout,
// surfacing as "failed to upload" in the composer. Pin the route explicitly
// and let the long-tail work happen post-response.
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

  const { id: postId } = await params;

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: session.user.id },
  });
  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const contentType = req.headers.get("content-type") ?? "";
    let buffer: Buffer;
    let pathname: string;
    let alreadyInR2 = false;

    if (contentType.includes("application/json")) {
      // Large file: client PUT directly to R2 using a presigned URL minted
      // by /api/posts/[id]/media/presign. We get the key back and fetch the
      // object for the same defense-in-depth sniff we'd do on a direct POST.
      const body = await req.json();
      const key = typeof body.key === "string" ? body.key : "";

      // Lock the key to this user's media prefix. Without this, the JSON
      // body could point at any object in R2 (e.g. another user's media,
      // an audio file, the import staging area) and we'd happily wire it
      // into this post's Media row.
      const userPrefix = `media/${session.user.id}/`;
      if (!key.startsWith(userPrefix)) {
        return NextResponse.json(
          { error: "Invalid storage key" },
          { status: 400 }
        );
      }

      pathname = key;
      alreadyInR2 = true;
      try {
        buffer = await getObject(r2UrlForKey(key));
      } catch (err) {
        console.error(
          "[api/posts/[id]/media] failed to fetch presigned object",
          err
        );
        return NextResponse.json(
          { error: "Failed to fetch uploaded file" },
          { status: 500 }
        );
      }
    } else {
      // Small file: sent directly as multipart/form-data. Server uploads to R2.
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }
      buffer = Buffer.from(await file.arrayBuffer());
      pathname = mediaKey(session.user.id, file.name);
    }

    // Sniff the actual content. Don't trust client-asserted Content-Type or
    // filename extension — both are trivially spoofable. The detected type is
    // what we record + what R2 serves back, so a mislabeled file can't be
    // rendered with a trusted MIME later.
    const detected = detectMimeType(buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected)) {
      // If the client already pushed the file to R2, the orphan must be
      // deleted now or it leaks. deleteObject swallows its own errors.
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
      const uploaded = await uploadBuffer(pathname, buffer, {
        contentType: mimeType,
      });
      storageKey = uploaded.url;
      hasAudio = uploaded.hasAudio;
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

    if (mimeType.startsWith("video/")) {
      // Compression + poster extraction both run post-response. Compress
      // first, then extract the poster from the compressed buffer so the
      // poster reflects what'll actually be served. If compression fails,
      // the original stays in R2 and we still try poster extraction; a
      // backfill can retry compression later.
      const mediaId = media.id;
      after(async () => {
        let workingBuffer = buffer;
        try {
          const { compressVideo } = await import("@/lib/video-processing");
          const compressed = await compressVideo(buffer);
          if (compressed !== buffer && compressed.length < buffer.length) {
            await uploadBuffer(pathname, compressed, { contentType: mimeType });
            await prisma.media.update({
              where: { id: mediaId },
              data: { sizeBytes: compressed.length },
            });
            workingBuffer = compressed;
          }
        } catch (err) {
          console.error(
            `[compress] FAILED for ${pathname}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }

        try {
          const { extractPoster } = await import("@/lib/video-processing");
          const posterBuffer = await extractPoster(workingBuffer);
          const posterPath = pathname.replace(/\.[^/.]+$/, "") + ".poster.jpg";
          await uploadBuffer(posterPath, posterBuffer, { contentType: "image/jpeg" });
        } catch (err) {
          console.error(
            `[posters] FAILED to generate poster for ${pathname}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      });
    }

    return NextResponse.json(media, { status: 201 });
  } catch (err) {
    console.error("[api/posts/[id]/media] upload failed", {
      postId,
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
