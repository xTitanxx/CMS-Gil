// Single-post embedding refresh. Used by:
//   - /api/posts/[id] PATCH (when body or tags change)
//   - analyze-post.ts (after Sonnet writes new tags)
//   - import-worker.ts (when a new post lands)
//
// Always fire-and-forget — never block the parent request on Voyage. Errors
// are logged; the post remains searchable via tag/phrase retrievers in the
// hybrid module until the next refresh succeeds.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  buildPostEmbeddingText,
  embedDocuments,
  toPgVectorLiteral,
} from "./embed";

export async function embedPost(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: { body: true, tags: true, captionSuggestion: true },
  });
  if (!post) return;

  const text = buildPostEmbeddingText(post);
  if (!text.trim()) return;

  const vectors = await embedDocuments([text]);
  if (!vectors || !vectors[0]) return;

  const vec = toPgVectorLiteral(vectors[0]);
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "Post" SET embedding = ${vec}::vector WHERE id = ${postId}`,
  );
}
