import { prisma } from "@/lib/prisma";
import { parseFacebookFile, guessMimeType, ParsedPost } from "@/lib/facebook-parser";
import { uploadBuffer, mediaKey } from "@/lib/storage";
import { ImportSource } from "@prisma/client";

interface ImportOptions {
  jobId: string;
  userId: string;
  // Either provide raw JSON string, or pre-parsed posts (e.g. merged from multiple files)
  jsonContent?: string;
  parsedPosts?: ParsedPost[];
  // Map of relative URI → Buffer (from ZIP extraction or Drive download)
  mediaFiles?: Map<string, Buffer>;
  source?: ImportSource;
}

export async function runImportJob(opts: ImportOptions): Promise<void> {
  const { jobId, userId, jsonContent, parsedPosts: preParsedPosts, mediaFiles = new Map(), source = "UPLOAD" } = opts;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const errors: string[] = [];

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

        for (const uri of parsed.mediaUris) {
          try {
            const normalizedUri = uri.replace(/^\/+/, "");
            const fileBuffer = mediaFiles.get(normalizedUri) ?? mediaFiles.get(uri);
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
