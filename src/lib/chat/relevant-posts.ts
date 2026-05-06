// Per-turn retrieval for /api/chat (the Archivist). Surfaces posts from the
// wider archive that fall outside the cached newest-N baseline.
//
// Backed by the unified hybridSearch (vector + tag + phrase + Haiku rerank)
// in src/lib/retrieval/hybrid-search.ts. Chat-specific concerns kept here:
//   - Date-aware shape (RelevantPost) for the prompt formatter.
//   - excludeIds dedup against the baseline cache.
//   - The "ADDITIONAL POSTS POSSIBLY RELEVANT" prompt block.

import { hybridSearch } from "@/lib/retrieval/hybrid-search";

export type RelevantPost = {
  id: string;
  body: string | null;
  tags: string[];
  originalDate: Date;
};

export async function getRelevantPosts(
  userId: string,
  query: string,
  excludeIds: Set<string>,
  limit = 12,
): Promise<RelevantPost[]> {
  if (!query.trim()) return [];
  const hits = await hybridSearch({
    userId,
    query,
    limit,
    excludeIds,
  });
  return hits.map((h) => ({
    id: h.postId,
    body: h.body,
    tags: h.tags,
    originalDate: h.originalDate ?? new Date(0),
  }));
}

export function formatRelevantPostsForPrompt(posts: RelevantPost[]): string {
  if (posts.length === 0) return "";
  const lines = posts.map((p) => {
    const date = new Date(p.originalDate).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const tags = p.tags.length > 0 ? ` [${p.tags.join(", ")}]` : "";
    const body = p.body?.trim() ?? "(no text)";
    return `[ID: ${p.id}] ${date}${tags}\n${body}`;
  });
  // Heading is intentionally directive — these posts came back from semantic
  // search ranked against the recent conversation, not a vague keyword sweep.
  // Soft language ("POSSIBLY") was making the model dismiss them too readily.
  return [
    `TOP MATCHES FROM SEMANTIC SEARCH (ranked by relevance to the current question; from the wider archive, NOT in the main list above):`,
    `These are the most relevant posts available — when discussing topics related to the user's question, prefer citing posts from THIS list.`,
    `---`,
    lines.join("\n---\n"),
    `---`,
  ].join("\n");
}
