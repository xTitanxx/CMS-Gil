import { prisma } from "@/lib/prisma";

const STOPWORDS = new Set([
  "the", "and", "for", "but", "with", "what", "when", "where", "why",
  "how", "has", "have", "had", "are", "was", "were", "does", "did",
  "can", "could", "would", "should", "will", "about", "gil", "post",
  "posts", "write", "writes", "written", "wrote", "talk", "talks",
  "say", "said", "says", "tell", "told", "share", "shared", "shares",
  "thought", "thoughts", "think", "thinks", "feel", "feels", "felt",
  "your", "you", "yours", "they", "them", "their", "from", "this",
  "that", "these", "those", "any", "anything", "something", "someone",
  "people", "person", "stuff", "thing", "things",
]);

const TOKEN_RE = /[a-z][a-z0-9]{2,}/g;

export function extractKeywords(query: string): string[] {
  const lowered = query.toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of lowered.matchAll(TOKEN_RE)) {
    const tok = match[0];
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

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
  limit = 25
): Promise<RelevantPost[]> {
  const tokens = extractKeywords(query);
  if (tokens.length === 0) return [];

  // Build OR clauses: each token can match either body (case-insensitive)
  // or be a member of tags. Tag matching is case-sensitive; we include
  // common case variants since tags are stored verbatim from the tagger.
  const tagVariants = new Set<string>();
  for (const t of tokens) {
    tagVariants.add(t);
    tagVariants.add(t[0].toUpperCase() + t.slice(1));
  }

  const orClauses: Array<
    | { body: { contains: string; mode: "insensitive" } }
    | { tags: { hasSome: string[] } }
  > = tokens.map((t) => ({
    body: { contains: t, mode: "insensitive" as const },
  }));
  // tags && ARRAY[...] catches every tag match for any token in one round-trip
  orClauses.push({ tags: { hasSome: Array.from(tagVariants) } });

  // Pull a wider slice than we'll keep so we can drop excluded IDs after.
  const matches = await prisma.post.findMany({
    where: {
      userId,
      OR: orClauses,
    },
    select: { id: true, body: true, tags: true, originalDate: true },
    orderBy: { originalDate: "desc" },
    take: limit + excludeIds.size,
  });

  const filtered: RelevantPost[] = [];
  for (const m of matches) {
    if (excludeIds.has(m.id)) continue;
    filtered.push(m);
    if (filtered.length >= limit) break;
  }
  return filtered;
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
  return [
    `ADDITIONAL POSTS POSSIBLY RELEVANT TO THIS QUESTION (from the wider archive, not in the main list above):`,
    `---`,
    lines.join("\n---\n"),
    `---`,
  ].join("\n");
}
