// Plain keyword retrieval for the public Archivist.
//
// Designed to behave like a search engine, not an AI agent: the user types
// words, we find posts containing those words, we rank by how well they match,
// and we return the top hits. No Haiku synonym expansion, no Haiku rerank,
// no vector-similarity broadening — those layers were occasionally pushing
// well-matched posts out of the top-N in favour of merely topical ones (see
// the trekinetic case: 13 brand-name mentions in the corpus, but RRF+rerank
// surfaced only 4 because wheelchair-themed posts crowded the candidate pool).
//
// If conceptual paraphrasing turns out to matter for some queries, that's a
// follow-up to bolt back on as a fallback when keyword search returns nothing.

import { Prisma } from "@prisma/client";
import type { PostType } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search-normalize";

// Words that carry no content on their own. Anything outside this set is
// treated as a search term. Kept intentionally small — over-aggressive
// stopword lists hide real signal (e.g. "MS" is only 2 chars but matters).
const STOPWORDS = new Set([
  "the", "and", "but", "for", "with", "that", "this", "what", "when", "where",
  "who", "how", "why", "does", "did", "you", "your", "yours", "have", "has",
  "had", "are", "was", "were", "been", "being", "not", "any", "all", "some",
  "more", "less", "also", "just", "only", "very", "much", "many", "into",
  "onto", "from", "about", "over", "under", "than", "then", "there", "these",
  "those", "they", "them", "their", "its", "his", "her", "him", "she", "gil",
  "gils", "post", "posts", "tell", "show", "say", "said", "talk", "talked",
  "talks", "talking", "share", "shared", "sharing", "write", "wrote", "writes",
  "written", "writing", "mention", "mentioned", "mentions", "saying",
  "anything", "everything", "something", "nothing", "please", "thanks", "thank",
]);

export interface KeywordHit {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
}

export interface KeywordSearchOptions {
  userId: string;
  query: string;
  excludeIds?: Set<string>;
  limit?: number;
  postTypes?: PostType[];
}

// Pull word-like tokens from the query, normalize to the same form used by
// Post.bodyNormalized, then drop stopwords and very short tokens.
//
// `\p{L}` (letters, including non-Latin scripts) + `\p{N}` (digits) keeps the
// tokenizer robust to Hebrew, accented Latin, etc. — Gil's corpus mixes
// languages, and stripping non-ASCII would drop real terms.
export function tokenizeQuery(query: string): string[] {
  const raw = (query.match(/[\p{L}\p{N}']+/gu) ?? []).map((w) => normalizeForSearch(w));
  const filtered = raw.filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  // Dedupe while preserving order so the first occurrence ranks earlier when
  // we display match reasons.
  return [...new Set(filtered)];
}

export async function keywordSearch(opts: KeywordSearchOptions): Promise<KeywordHit[]> {
  const terms = tokenizeQuery(opts.query);
  if (terms.length === 0) return [];

  // Default of 25 is generous enough that a narrow query like a brand name
  // can surface every matching post in the corpus (the trekinetic case had
  // 13 matches — capping at 12 silently dropped one). Broader queries still
  // get plenty of candidates without flooding the model's context.
  const limit = opts.limit ?? 25;
  const postTypes = opts.postTypes;

  // OR across terms — we want any post that contains at least one term, then
  // we score by how many distinct terms matched. Over-fetch a few hundred so
  // the JS scorer (which uses string operations Prisma can't express) picks
  // the genuinely strongest matches, not just the most recent OR-hits.
  const FETCH_CAP = 500;
  const rows = await prisma.post.findMany({
    where: {
      userId: opts.userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      ...(postTypes ? { postType: { in: postTypes } } : {}),
      OR: terms.map((t) => ({ bodyNormalized: { contains: t } })),
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      tags: true,
      originalDate: true,
    },
    orderBy: { originalDate: "desc" },
    take: FETCH_CAP,
  });

  const excluded = opts.excludeIds ?? new Set<string>();
  const scored = rows
    .filter((r) => !excluded.has(r.id))
    .map((r) => {
      const bodyLower = r.bodyNormalized;
      const tagBlob = r.tags.map((t) => t.toLowerCase()).join(" ");
      let coverage = 0;
      let bodyHits = 0;
      let tagHits = 0;
      for (const t of terms) {
        const inBody = bodyLower.split(t).length - 1;
        const inTags = tagBlob.split(t).length - 1;
        if (inBody > 0 || inTags > 0) coverage++;
        bodyHits += inBody;
        tagHits += inTags;
      }
      return {
        id: r.id,
        body: r.body,
        tags: r.tags,
        originalDate: r.originalDate,
        coverage,
        bodyHits,
        tagHits,
      };
    })
    .filter((r) => r.coverage > 0)
    .sort((a, b) => {
      // Primary: distinct query terms matched — a post hitting all the user's
      // terms is a stronger match than one hitting just a popular term.
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      // Secondary: total body occurrences (term-frequency proxy).
      if (b.bodyHits !== a.bodyHits) return b.bodyHits - a.bodyHits;
      // Tertiary: tag hits — tags were chosen as topical, so a tag mention is
      // a slightly stronger signal than nothing.
      if (b.tagHits !== a.tagHits) return b.tagHits - a.tagHits;
      // Final tiebreak: newer first, so a flood of equally-scoring matches
      // leans toward more recent posts.
      return b.originalDate.getTime() - a.originalDate.getTime();
    });

  return scored.slice(0, limit).map(({ id, body, tags, originalDate }) => ({
    id,
    body,
    tags,
    originalDate,
  }));
}
