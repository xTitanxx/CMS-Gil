// Per-turn retrieval for /api/chat (the Archivist). Surfaces posts from the
// wider archive that fall outside the cached newest-N baseline.
//
// The Archivist behaves as a librarian, not an interpreter, so the retrieval
// behaves as a plain keyword search — the user types words, we hand back
// posts that contain those words, ranked by coverage. No vector embeddings,
// no Haiku synonym expansion, no Haiku rerank: those layers had a habit of
// boosting topically-adjacent posts over posts containing the user's literal
// words (the trekinetic case — 13 brand-name mentions in the corpus, yet
// rerank surfaced only 4 because wheelchair-themed posts crowded the pool).
//
// Chat-specific concerns kept here:
//   - Date-aware shape (RelevantPost) for the prompt formatter.
//   - excludeIds dedup against the baseline cache.
//   - The "TOP MATCHES" prompt block.

import { keywordSearch } from "@/lib/chat/keyword-search";

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
  limit = 25,
): Promise<RelevantPost[]> {
  if (!query.trim()) return [];
  const hits = await keywordSearch({
    userId,
    query,
    excludeIds,
    limit,
    // The public Archivist only surfaces original POSTs — STORY and REEL are
    // excluded from the public feed per the project's content rules.
    postTypes: ["POST"],
  });
  return hits.map((h) => ({
    id: h.id,
    body: h.body,
    tags: h.tags,
    originalDate: h.originalDate,
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
  // Heading is intentionally directive — these posts came back ranked by how
  // many of the user's literal words they contain, drawn from the wider
  // archive beyond the cached newest-N baseline.
  return [
    `TOP MATCHES FROM KEYWORD SEARCH (ranked by how many of the user's words appear in each post; retrieved from the wider archive beyond the newest-50 baseline):`,
    `These are the most relevant posts available — when discussing topics related to the user's question, prefer citing posts from THIS list.`,
    `---`,
    lines.join("\n---\n"),
    `---`,
  ].join("\n");
}
