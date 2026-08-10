import { prisma } from "@/lib/prisma";
import { parseFacebookFile, guessMimeType, ParsedPost } from "@/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { ImportSource } from "@prisma/client";
import { analyzePost } from "@/lib/analyze-post";
import { normalizeForSearch } from "@/lib/search-normalize";

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
  jsonContent?: string;
  parsedPosts?: ParsedPost[];
  // Lazy media loader — reads one file at a time (preferred, avoids loading all into memory)
  getMedia?: (uri: string) => Promise<Buffer | null>;
  // Legacy: pre-loaded map (still supported for Drive sync)
  mediaFiles?: Map<string, Buffer>;
  source?: ImportSource;
}

function isStorageConfigured(): boolean {
  return !!process.env.R2_ENDPOINT;
}

export async function runImportJob(opts: ImportOptions): Promise<void> {
  const {
    jobId,
    userId,
    jsonContent,
    parsedPosts: preParsedPosts,
    getMedia,
    mediaFiles = new Map(),
  } = opts;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const errors: string[] = [];
  const throttle = createSemaphore(5);
  const tagPromises: Promise<void | string[]>[] = [];
  const storageEnabled = isStorageConfigured();

  try {
    let posts: ParsedPost[];

    if (preParsedPosts && preParsedPosts.length > 0) {
      posts = preParsedPosts;
    } else if (jsonContent) {
      let raw: unknown;
      try {
        raw = JSON.parse(jsonContent);
      } catch {
        throw new Error("Invalid JSON file");
      }
      posts = parseFacebookFile(raw);
    } else {
      throw new Error("No content provided to import");
    }

    await prisma.importJob.update({
      where: { id: jobId },
      data: { totalPosts: posts.length },
    });

    let imported = 0;
    let skipped = 0;

    for (const parsed of posts) {
      try {
        const existing = await prisma.post.findFirst({
          where: { userId, sourceId: parsed.sourceId },
        });
        if (existing) {
          skipped++;
          continue;
        }

        // Stories and reels are also repeated in Facebook's generic posts
        // export. Reconcile them to an existing row only when an exact media
        // URI and a nearby timestamp identify one unambiguous candidate.
        if (parsed.postType === "STORY" || parsed.postType === "REEL") {
          const from = new Date(parsed.originalDate.getTime() - 24 * 60 * 60 * 1000);
          const to = new Date(parsed.originalDate.getTime() + 24 * 60 * 60 * 1000);
          const candidates = await prisma.post.findMany({
            where: {
              userId,
              originalDate: { gte: from, lte: to },
              media: { some: { originalUri: { in: parsed.mediaUris } } },
            },
            select: { id: true, body: true },
            take: 2,
          });
          if (candidates.length === 1) {
            const candidate = candidates[0];
            const body = parsed.body || candidate.body;
            await prisma.post.update({
              where: { id: candidate.id },
              data: {
                postType: parsed.postType,
                originalDate: parsed.originalDate,
                body,
                bodyNormalized: normalizeForSearch(body),
              },
            });
            imported++;
            await prisma.importJob.update({
              where: { id: jobId },
              data: { importedPosts: imported, skippedPosts: skipped },
            });
            continue;
          }
          if (candidates.length > 1) {
            errors.push(
              `Ambiguous ${parsed.postType.toLowerCase()} ${parsed.sourceId}: multiple posts share its exact media URI`,
            );
            skipped++;
            continue;
          }
        }

        const post = await prisma.post.create({
          data: {
            userId,
            body: parsed.body ?? "",
            bodyNormalized: normalizeForSearch(parsed.body ?? ""),
            source: "FACEBOOK",
            sourceId: parsed.sourceId,
            originalDate: parsed.originalDate,
            postType: parsed.postType ?? "POST",
            share: parsed.share ? (parsed.share as object) : undefined,
          },
        });

        // Track media outcomes so we can drop ghost posts at the end —
        // your_videos.json and album JSONs frequently reference media files
        // that aren't in the actual export (FB JSON-only exports, partial
        // ZIPs). Without this cleanup those leave behind Post rows with no
        // body and no media: pure noise that pollutes the feed.
        let mediaAttached = 0;

        // Only attempt media upload if storage is configured
        if (storageEnabled) {
          for (const uri of parsed.mediaUris) {
            try {
              // Try lazy loader first, fall back to pre-loaded map
              const normalizedUri = uri.replace(/^\/+/, "");
              let fileBuffer: Buffer | null = null;

              if (getMedia) {
                fileBuffer = await getMedia(uri);
              } else {
                fileBuffer = mediaFiles.get(normalizedUri) ?? mediaFiles.get(uri) ?? null;
              }

              if (!fileBuffer) {
                errors.push(`Media missing for post ${parsed.sourceId}: ${uri}`);
                continue;
              }

              const filename = uri.split("/").pop() ?? "media";
              const mimeType = guessMimeType(filename);
              const key = mediaKey(userId, filename);

              // Compress oversized videos before they ever hit R2 — saves both
              // storage and an extra read/write round-trip vs. compressing
              // after upload. Falls back to the original buffer on failure.
              let uploadBufferBytes = fileBuffer;
              if (mimeType.startsWith("video/")) {
                try {
                  const { compressVideo } = await import("@/lib/video-processing");
                  const compressed = await compressVideo(fileBuffer);
                  if (compressed.length < fileBuffer.length) {
                    uploadBufferBytes = compressed;
                  }
                } catch (err) {
                  errors.push(`Compression failed for ${parsed.sourceId}: ${String(err)}`);
                }
              }

              const { url: storageKey, hasAudio } = await uploadBuffer(key, uploadBufferBytes, {
                contentType: mimeType,
              });

              if (mimeType.startsWith("video/")) {
                try {
                  const { extractPoster } = await import("@/lib/video-processing");
                  const posterBuffer = await extractPoster(uploadBufferBytes);
                  const posterPath = key.replace(/\.[^/.]+$/, "") + ".poster.jpg";
                  await uploadBuffer(posterPath, posterBuffer, { contentType: "image/jpeg" });
                } catch (err) {
                  errors.push(`Poster extraction failed for ${parsed.sourceId}: ${String(err)}`);
                }
              }

              await prisma.media.create({
                data: {
                  postId: post.id,
                  storageKey,
                  originalUri: uri,
                  mimeType,
                  sizeBytes: uploadBufferBytes.length,
                  hasAudio,
                },
              });
              mediaAttached++;
            } catch (mediaErr) {
              errors.push(`Media error for post ${parsed.sourceId}: ${String(mediaErr)}`);
            }
          }
        }

        // Drop ghost posts: zero media attached and no body. Common when a
        // your_videos.json or album JSON references media files that the FB
        // export didn't actually include. Skip the cleanup when the post was
        // never expected to have media (mediaUris was empty AND body was
        // empty in the source — which is a parser bug worth keeping visible).
        const bodyIsEmpty = !(parsed.body ?? "").trim();
        const wasMediaPost = parsed.mediaUris.length > 0;
        if (wasMediaPost && mediaAttached === 0 && bodyIsEmpty) {
          await prisma.post.delete({ where: { id: post.id } });
          skipped++;
          errors.push(
            `Dropped ghost post ${parsed.sourceId}: ${parsed.mediaUris.length} media URI(s) referenced, none found`,
          );
          await prisma.importJob.update({
            where: { id: jobId },
            data: { importedPosts: imported, skippedPosts: skipped },
          });
          continue;
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
