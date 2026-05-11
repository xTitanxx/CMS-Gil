// Hybrid post retrieval used by /api/chat and /api/assistant.
//
// Three retrievers run in parallel:
//   - Vector (pgvector cosine on Post.embedding) — semantic recall.
//   - Tag (Haiku-mapped tags via mapQuery) — facet recall.
//   - Phrase (bodyNormalized.contains) — exact-text recall.
//
// Their ranked ID lists are merged via Reciprocal Rank Fusion (k=60).
// The merged top-N is then optionally reranked by a single batched Haiku
// scoring call against the original query — RRF gets candidates; rerank
// picks the right one. This is the precision lever the keyword-only path
// could not provide.
//
// All three retrievers degrade gracefully:
//   - Vector returns nothing when VOYAGE_API_KEY is missing or the post has
//     no embedding row. The other two retrievers carry the result.
//   - Tag returns nothing when mapQuery extracts no tags/keywords.
//   - Phrase only fires when the normalized query is ≥ 12 chars.
//
// See plan: ~/.claude/plans/one-of-if-not-virtual-moore.md

import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import type { Lifecycle, PostType, Season } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search-normalize";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { classifyContent } from "@/lib/assistant/classify";
import { mapQuery } from "@/lib/assistant/retrieve";
import type { ContentKind, RetrieveHit } from "@/lib/assistant/types";
import { embedQuery, toPgVectorLiteral } from "./embed";

const RRF_K = 60;
const PER_RETRIEVER_LIMIT = 50;
const RERANK_MODEL = "claude-haiku-4-5";

const anthropic = new Anthropic();

export interface HybridSearchOptions {
  userId: string;
  query: string;
  limit?: number;
  excludeIds?: Set<string>;
  // Filters applied to all three retrievers (post-fetch).
  lifecycle?: Lifecycle;
  season?: Season;
  contentKind?: ContentKind;
  dateRange?: { from?: Date; to?: Date };
  // When false, skip the Haiku rerank pass — useful for tests or callers
  // that prioritize latency over precision. Defaults to true.
  rerank?: boolean;
  // Restrict results to specific post kinds. The Archivist passes ["POST"] to
  // exclude STORY and REEL entries (public-feed rule: these types are not
  // surfaced to followers). Omit for the admin assistant which can see all.
  postTypes?: PostType[];
}

interface RankedId {
  id: string;
  rank: number; // 0-indexed
}

// ─── Retrievers ─────────────────────────────────────────────────────────────

async function vectorCandidates(
  userId: string,
  queryVec: number[],
  limit: number,
  postTypes?: PostType[],
): Promise<RankedId[]> {
  const vec = toPgVectorLiteral(queryVec);
  // Order by cosine distance ascending (closer = more similar). Filter ARCHIVED
  // and shared posts at the SQL level. We stay loose on lifecycle/season/etc
  // here and apply those in app code after fetching the full row — keeps the
  // raw query simple at our corpus size (~5k rows).
  // Cast the column to text — comparing the PostType enum directly against a
  // text[] param errors with `operator does not exist: "PostType" = text` and
  // takes down the entire hybridSearch (vector branch throws, the chat catches,
  // Archivist silently falls back to newest-50 baseline with no semantic
  // retrieval). Archivist passes postTypes=["POST"] every turn, so any topic
  // outside the baseline window stays invisible until this cast is right.
  const postTypeClause = postTypes
    ? Prisma.sql`AND "postType"::text = ANY(${postTypes}::text[])`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM "Post"
    WHERE "userId" = ${userId}
      AND embedding IS NOT NULL
      AND readiness != 'ARCHIVED'
      AND share IS NULL
      ${postTypeClause}
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${limit}
  `;
  return rows.map((r, i) => ({ id: r.id, rank: i }));
}

async function tagCandidates(
  userId: string,
  query: string,
  limit: number,
  postTypes?: PostType[],
): Promise<RankedId[]> {
  const mapped = await mapQuery(userId, query);
  // Always seed keywords with the raw query words (>= 3 chars) so we never
  // miss a body match Haiku failed to elicit.
  const rawWords = query.split(/\s+/).filter((w) => w.length >= 3);
  for (const w of rawWords) {
    if (!mapped.keywords.some((k) => k.toLowerCase() === w.toLowerCase())) {
      mapped.keywords.push(w);
    }
  }
  if (mapped.tags.length === 0 && mapped.keywords.length === 0) return [];

  const orClauses: Prisma.PostWhereInput[] = [];
  if (mapped.tags.length > 0) orClauses.push({ tags: { hasSome: mapped.tags } });
  for (const k of mapped.keywords) {
    orClauses.push({ bodyNormalized: { contains: normalizeForSearch(k) } });
  }

  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      ...(postTypes ? { postType: { in: postTypes } } : {}),
      OR: orClauses,
    },
    select: { id: true, tags: true, bodyNormalized: true },
    take: limit,
  });
  // Score for ordering inside this retriever: tag overlap counts double,
  // keyword hits count single. Prefer richer matches first.
  const scored = rows.map((r) => {
    const tagMatches = r.tags.filter((t) => mapped.tags.includes(t)).length;
    const kwHits = mapped.keywords.reduce(
      (s, k) =>
        s + (r.bodyNormalized.includes(normalizeForSearch(k)) ? 1 : 0),
      0,
    );
    return { id: r.id, score: tagMatches * 2 + kwHits };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((r, i) => ({ id: r.id, rank: i }));
}

async function phraseCandidates(
  userId: string,
  query: string,
  limit: number,
  postTypes?: PostType[],
): Promise<RankedId[]> {
  const normalized = normalizeForSearch(query);
  if (normalized.length < 12) return [];
  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      ...(postTypes ? { postType: { in: postTypes } } : {}),
      bodyNormalized: { contains: normalized },
    },
    select: { id: true, originalDate: true },
    orderBy: { originalDate: "desc" },
    take: limit,
  });
  return rows.map((r, i) => ({ id: r.id, rank: i }));
}

// ─── RRF ────────────────────────────────────────────────────────────────────

interface FusedHit {
  id: string;
  fusedScore: number;
  reasons: string[];
}

function reciprocalRankFusion(
  lists: { name: string; ranked: RankedId[] }[],
): FusedHit[] {
  const accum = new Map<string, FusedHit>();
  for (const { name, ranked } of lists) {
    for (const { id, rank } of ranked) {
      const score = 1 / (RRF_K + rank + 1);
      const existing = accum.get(id);
      if (existing) {
        existing.fusedScore += score;
        existing.reasons.push(name);
      } else {
        accum.set(id, { id, fusedScore: score, reasons: [name] });
      }
    }
  }
  return [...accum.values()].sort((a, b) => b.fusedScore - a.fusedScore);
}

// ─── Full-row hydration ─────────────────────────────────────────────────────

interface HydratedPost {
  id: string;
  body: string;
  bodyNormalized: string;
  tags: string[];
  lifecycle: Lifecycle;
  season: Season | null;
  postType: PostType;
  platformUrl: string | null;
  originalDate: Date;
  stars: number | null;
  thumbUrl: string | null;
  contentKind: ContentKind;
}

async function hydratePosts(ids: string[]): Promise<Map<string, HydratedPost>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      tags: true,
      lifecycle: true,
      season: true,
      postType: true,
      platformUrl: true,
      originalDate: true,
      rating: { select: { stars: true } },
      media: {
        orderBy: { id: "asc" },
        select: { storageKey: true, mimeType: true },
      },
    },
  });
  const map = new Map<string, HydratedPost>();
  for (const p of rows) {
    const mimes = p.media.map((m) => m.mimeType);
    const thumbSource =
      p.media.find((m) => m.mimeType.startsWith("image/")) ?? p.media[0];
    map.set(p.id, {
      id: p.id,
      body: p.body,
      bodyNormalized: p.bodyNormalized,
      tags: p.tags,
      lifecycle: p.lifecycle,
      season: p.season,
      postType: p.postType,
      platformUrl: p.platformUrl,
      originalDate: p.originalDate,
      stars: p.rating?.stars ?? null,
      thumbUrl: buildThumbUrl(thumbSource?.storageKey, thumbSource?.mimeType),
      contentKind: classifyContent({
        postType: p.postType,
        body: p.body,
        mediaMimes: mimes,
      }),
    });
  }
  return map;
}

// ─── Haiku rerank ───────────────────────────────────────────────────────────

const RERANK_SNIPPET_LEN = 280;

async function haikuRerank(
  query: string,
  candidates: HydratedPost[],
): Promise<Map<string, number>> {
  if (candidates.length === 0) return new Map();
  // Build numbered list with short snippets — keeps total tokens ~1k.
  const lines = candidates
    .map((c, i) => {
      const snippet = (c.body || "").trim().replace(/\s+/g, " ").slice(0, RERANK_SNIPPET_LEN);
      const tagLine = c.tags.length > 0 ? `[${c.tags.slice(0, 8).join(", ")}] ` : "";
      return `${i + 1}. id=${c.id} ${tagLine}${snippet}`;
    })
    .join("\n");
  const prompt = `Score how well each candidate post answers the query. Return only valid JSON: an array like [{"id":"...","score":0.0}] where score is between 0 and 1 (1 = highly relevant, 0 = irrelevant). Include every candidate id. No commentary.

Query: ${query}

Candidates:
${lines}`;

  try {
    const resp = await anthropic.messages.create({
      model: RERANK_MODEL,
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const text =
      resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "[]";
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return new Map();
    const parsed = JSON.parse(match[0]) as { id: string; score: number }[];
    const scores = new Map<string, number>();
    for (const item of parsed) {
      if (typeof item.id === "string" && typeof item.score === "number") {
        scores.set(item.id, item.score);
      }
    }
    return scores;
  } catch (e) {
    console.error("[hybridSearch] rerank failed:", e);
    return new Map();
  }
}

// ─── Filters ────────────────────────────────────────────────────────────────

function applyFilters(
  posts: HydratedPost[],
  opts: HybridSearchOptions,
): HydratedPost[] {
  return posts.filter((p) => {
    if (opts.lifecycle && p.lifecycle !== opts.lifecycle) return false;
    if (opts.season && p.season !== opts.season) return false;
    if (opts.contentKind && p.contentKind !== opts.contentKind) return false;
    if (opts.dateRange?.from && p.originalDate < opts.dateRange.from) return false;
    if (opts.dateRange?.to && p.originalDate > opts.dateRange.to) return false;
    return true;
  });
}

// ─── Main entry ─────────────────────────────────────────────────────────────

export async function hybridSearch(opts: HybridSearchOptions): Promise<RetrieveHit[]> {
  const limit = opts.limit ?? 20;
  const rerank = opts.rerank ?? true;

  // Embed query (if Voyage configured) in parallel with starting tag mapping.
  const [queryVec, tagRanked, phraseRanked] = await Promise.all([
    embedQuery(opts.query),
    tagCandidates(opts.userId, opts.query, PER_RETRIEVER_LIMIT, opts.postTypes),
    phraseCandidates(opts.userId, opts.query, PER_RETRIEVER_LIMIT, opts.postTypes),
  ]);

  const vectorRanked = queryVec
    ? await vectorCandidates(opts.userId, queryVec, PER_RETRIEVER_LIMIT, opts.postTypes)
    : [];

  // RRF merge.
  const fused = reciprocalRankFusion([
    { name: "vector", ranked: vectorRanked },
    { name: "tag", ranked: tagRanked },
    { name: "phrase", ranked: phraseRanked },
  ]);

  // Drop excluded IDs early, then truncate to the rerank candidate set.
  const excluded = opts.excludeIds ?? new Set<string>();
  const preRerank = fused.filter((f) => !excluded.has(f.id)).slice(0, Math.max(limit * 2, 20));
  if (preRerank.length === 0) return [];

  const hydrated = await hydratePosts(preRerank.map((f) => f.id));
  // Apply post-fetch filters (lifecycle/season/contentKind/dateRange).
  const inOrder = preRerank
    .map((f) => hydrated.get(f.id))
    .filter((p): p is HydratedPost => Boolean(p));
  const filtered = applyFilters(inOrder, opts);
  if (filtered.length === 0) return [];

  // Optional Haiku rerank.
  const rerankScores = rerank ? await haikuRerank(opts.query, filtered.slice(0, 20)) : new Map();

  const ranked = filtered
    .map((p) => {
      const fusedHit = preRerank.find((f) => f.id === p.id);
      const rerankScore = rerankScores.get(p.id);
      // Combined score: rerank dominates when present (×10 weight), fused is tiebreaker.
      const combined =
        (rerankScore !== undefined ? rerankScore * 10 : 0) +
        (fusedHit?.fusedScore ?? 0);
      const reasons = fusedHit?.reasons.slice() ?? [];
      if (rerankScore !== undefined) {
        reasons.push(`rerank ${rerankScore.toFixed(2)}`);
      }
      if (p.stars) reasons.push(`${p.stars}★`);
      return {
        post: p,
        combined,
        reasons,
      };
    })
    .sort((a, b) => b.combined - a.combined)
    .slice(0, limit);

  return ranked.map(({ post, combined, reasons }) => ({
    postId: post.id,
    score: combined,
    matchReasons: reasons,
    highlightSnippet: extractSnippet(post.body, opts.query),
    body: post.body,
    tags: post.tags,
    stars: post.stars,
    lifecycle: post.lifecycle,
    thumbUrl: post.thumbUrl,
    contentKind: post.contentKind,
    platformUrl: post.platformUrl,
    originalDate: post.originalDate,
  }));
}

function extractSnippet(body: string, query: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  const words = query.split(/\s+/).filter((w) => w.length >= 3);
  for (const w of words) {
    const i = clean.toLowerCase().indexOf(w.toLowerCase());
    if (i >= 0) {
      const start = Math.max(0, i - 40);
      return (
        (start > 0 ? "…" : "") +
        clean.slice(start, start + 140) +
        (start + 140 < clean.length ? "…" : "")
      );
    }
  }
  return clean.slice(0, 140) + (clean.length > 140 ? "…" : "");
}
