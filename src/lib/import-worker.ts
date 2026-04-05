import { prisma } from "@/lib/prisma";
import { parseFacebookExport, guessMimeType } from "@/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { ImportSource } from "@prisma/client";
import { analyzePost } from "@/lib/analyze-post";

function createSemaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

interface ImportOptions {
  jobId: string;
  userId: string;
  jsonContent: string;
  // Map of relative URI → Buffer (from ZIP extraction or Drive download)
  mediaFiles?: Map<string, Buffer>;
  source?: ImportSource;
}

export async function runImportJob(opts: ImportOptions): Promise<void> {
  const { jobId, userId, jsonContent, mediaFiles = new Map(), source = "UPLOAD" } = opts;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const errors: string[] = [];
  const throttle = createSemaphore(5);
  const tagPromises: Promise<void | string[]>[] = [];

  try {
    let raw: unknown;
    try {
      raw = JSON.parse(jsonContent);
    } catch {
      throw new Error("Invalid JSON file");
    }

    const posts = parseFacebookExport(raw);

    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalPosts: posts.length },
    });

    let imported = 0;
    let skipped = 0;

    for (const parsed of posts) {
      try {
        // Skip duplicates by sourceId
        const existing = await prisma.post.findFirst({
          where: { userId, sourceId: parsed.sourceId },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Create the post
        const post = await prisma.post.create({
          data: {
            userId,
            body: parsed.body || "(no text)",
            source: "FACEBOOK",
            sourceId: parsed.sourceId,
            originalDate: parsed.originalDate,
          },
        });

        // Upload media files
        for (const uri of parsed.mediaUris) {
          try {
            const normalizedUri = uri.replace(/^\/+/, "");
            const basename = uri.split("/").pop() ?? uri;
            const fileBuffer =
              mediaFiles.get(normalizedUri) ??
              mediaFiles.get(uri) ??
              mediaFiles.get(basename);
            if (!fileBuffer) continue;

            const filename = uri.split("/").pop() ?? "media";
            const mimeType = guessMimeType(filename);
            const key = mediaKey(userId, filename);

            await uploadBuffer(key, fileBuffer, mimeType);

            await prisma.media.create({
              data: {
                postId: post.id,
                storageKey: key,
                originalUri: uri,
                mimeType,
                sizeBytes: fileBuffer.length,
              },
            });
          } catch (mediaErr) {
            errors.push(`Media error for post ${parsed.sourceId}: ${String(mediaErr)}`);
          }
        }

        imported++;

        // Fire-and-forget tagging — does not block import progress
        tagPromises.push(
          throttle(() => analyzePost(post.id).catch(() => {}))
        );

        // Update progress every post so the UI counter stays live
        await prisma.importJob.update({
          where: { id: jobId },
          data: { importedPosts: imported, skippedPosts: skipped },
        });
      } catch (postErr) {
        errors.push(`Post error ${parsed.sourceId}: ${String(postErr)}`);
        skipped++;
      }
    }

    await Promise.allSettled(tagPromises);

    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "COMPLETED",
        importedPosts: imported,
        skippedPosts: skipped,
        completedAt: new Date(),
        errorLog: errors.length > 0 ? JSON.stringify(errors) : null,
      },
    });
  } catch (err) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorLog: JSON.stringify([String(err), ...errors]),
      },
    });
  }
}
