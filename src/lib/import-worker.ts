import { prisma } from "@/lib/prisma";
import { parseFacebookFile, guessMimeType, ParsedPost } from "@/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { ImportSource } from "@prisma/client";

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
  return !!(
    process.env.S3_BUCKET &&
    process.env.S3_ACCESS_KEY_ID &&
    process.env.S3_SECRET_ACCESS_KEY
  );
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

        const post = await prisma.post.create({
          data: {
            userId,
            body: parsed.body || "(no text)",
            source: "FACEBOOK",
            sourceId: parsed.sourceId,
            originalDate: parsed.originalDate,
          },
        });

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
        }

        imported++;

        if (imported % 10 === 0) {
          await prisma.importJob.update({
            where: { id: jobId },
            data: { importedPosts: imported, skippedPosts: skipped },
          });
        }
      } catch (postErr) {
        errors.push(`Post error ${parsed.sourceId}: ${String(postErr)}`);
        skipped++;
      }
    }

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
