import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import type { Lifecycle, PostType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ContentKind, RetrieveHit, RetrieveOptions } from "./types";
import { classifyContent } from "./classify";
import { buildThumbUrl } from "@/lib/planner/thumbnail";
import { normalizeForSearch } from "@/lib/search-normalize";

const anthropic = new Anthropic();

interface PostSlim {
  id: string;
  body: string;
  bodyNormalized: string;
  tags: string[];
  stars: number | null;
  lifecycle: Lifecycle;
  thumbUrl: string | null;
  contentKind: ContentKind;
  platformUrl: string | null;
}

interface MappedQuery {
  tags: string[];
  keywords: string[];
}

export async function mapQuery(userId: string, query: string): Promise<MappedQuery> {
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT unnest(tags) AS tag FROM "Post" WHERE "userId" = ${userId}
  `;
  const available = rows.map((r) => r.tag);
  const prompt = `You map a natural-language search into tags and keywords for a personal post archive.
Available tags: ${available.join(", ") || "(none)"}
Query: "${query}"
Return only JSON: {"tags": string[], "keywords": string[]}. Tags must come from the available list. Keywords are free-text terms to search in post bodies — always include the core words from the query plus synonyms/related terms.`;

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    resp.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { tags: [], keywords: [] };

  try {
    const parsed = JSON.parse(match[0]) as MappedQuery;
    return {
      tags: Array.isArray(parsed.tags) ? parsed.tags.filter((t) => typeof t === "string") : [],
      keywords: Array.isArray(parsed.keywords)
        ? parsed.keywords.filter((k) => typeof k === "string")
        : [],
    };
  } catch {
    return { tags: [], keywords: [] };
  }
}

export function rankHits(
  posts: PostSlim[],
  q: MappedQuery,
  normalizedPhrase?: string,
): RetrieveHit[] {
  const denom = Math.max(1, q.tags.length + q.keywords.length);
  const phrase = normalizedPhrase && normalizedPhrase.length >= 4 ? normalizedPhrase : null;
  return posts
    .map((p) => {
      // Fall back to a runtime normalize when callers (e.g. tests) don't supply
      // bodyNormalized — keeps unit tests simple while production hits the DB
      // column directly.
      const normBody = p.bodyNormalized || normalizeForSearch(p.body);
      const tagMatches = p.tags.filter((t) => q.tags.includes(t)).length;
      const kwHits = q.keywords.reduce(
        (s, k) => s + (normBody.includes(normalizeForSearch(k)) ? 1 : 0),
        0,
      );
      const phraseHit = phrase ? normBody.includes(phrase) : false;
      const ratingBoost = p.stars ? (p.stars - 3) * 0.1 : 0;
      const phraseBoost = phraseHit ? 5 : 0;
      const score = (tagMatches * 2 + kwHits) / denom + ratingBoost + phraseBoost;
      const reasons: string[] = [];
      if (phraseHit) reasons.push("exact phrase match");
      if (tagMatches) reasons.push(`${tagMatches} tag match${tagMatches === 1 ? "" : "es"}`);
      if (kwHits) reasons.push(`${kwHits} keyword hit${kwHits === 1 ? "" : "s"}`);
      if (p.stars) reasons.push(`${p.stars}★`);
      return {
        postId: p.id,
        score,
        matchReasons: reasons,
        highlightSnippet: extractSnippet(p.body, q.keywords),
        body: p.body,
        tags: p.tags,
        stars: p.stars,
        lifecycle: p.lifecycle,
        thumbUrl: p.thumbUrl,
        contentKind: p.contentKind,
        platformUrl: p.platformUrl,
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function extractSnippet(body: string, keywords: string[]): string {
  const clean = body.replace(/\s+/g, " ").trim();
  for (const k of keywords) {
    const i = clean.toLowerCase().indexOf(k.toLowerCase());
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

export async function retrieve(opts: RetrieveOptions): Promise<RetrieveHit[]> {
  const limit = opts.limit ?? 20;
  const hasQuery = opts.query.trim().length > 0;
  const hasDateRange = !!(opts.dateRange?.from || opts.dateRange?.to);

  // Date-only queries ("posts from 2023") have no text to embed/keyword-match.
  // Skip hybridSearch and return chronological hits in the date window so the
  // assistant doesn't tell the user "I couldn't find any".
  if (!hasQuery && hasDateRange) {
    return chronologicalDateRange(opts, limit);
  }
  if (!hasQuery) return [];

  // Delegate everything else to the unified hybrid retrieval (vector + tag +
  // phrase + Haiku rerank). hybridSearch already handles phrase-first matches,
  // mapQuery, and filter pushdown for lifecycle/season/contentKind/dateRange.
  const { hybridSearch } = await import("@/lib/retrieval/hybrid-search");
  return hybridSearch({
    userId: opts.userId,
    query: opts.query,
    limit,
    lifecycle: opts.lifecycle,
    season: opts.season,
    contentKind: opts.contentKind,
    dateRange: opts.dateRange,
  });
}

async function chronologicalDateRange(
  opts: RetrieveOptions,
  limit: number,
): Promise<RetrieveHit[]> {
  const posts = await prisma.post.findMany({
    where: {
      userId: opts.userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      ...(opts.lifecycle ? { lifecycle: opts.lifecycle } : {}),
      ...(opts.season ? { season: opts.season } : {}),
      ...(opts.dateRange?.from || opts.dateRange?.to
        ? {
            originalDate: {
              ...(opts.dateRange?.from ? { gte: opts.dateRange.from } : {}),
              ...(opts.dateRange?.to ? { lte: opts.dateRange.to } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      tags: true,
      lifecycle: true,
      postType: true,
      platformUrl: true,
      originalDate: true,
      rating: { select: { stars: true } },
      media: {
        orderBy: { id: "asc" },
        select: { storageKey: true, mimeType: true },
      },
    },
    orderBy: { originalDate: "desc" },
    take: limit,
  });
  const slim: PostSlim[] = posts.map(
    (p: {
      id: string;
      body: string;
      bodyNormalized: string;
      tags: string[];
      lifecycle: Lifecycle;
      postType: PostType;
      platformUrl: string | null;
      rating: { stars: number } | null;
      media: { storageKey: string; mimeType: string }[];
    }) => {
      const mimes = p.media.map((m) => m.mimeType);
      const thumbSource =
        p.media.find((m) => m.mimeType.startsWith("image/")) ?? p.media[0];
      return {
        id: p.id,
        body: p.body,
        bodyNormalized: p.bodyNormalized,
        tags: p.tags,
        stars: p.rating?.stars ?? null,
        lifecycle: p.lifecycle,
        thumbUrl: buildThumbUrl(thumbSource?.storageKey, thumbSource?.mimeType),
        contentKind: classifyContent({
          postType: p.postType,
          body: p.body,
          mediaMimes: mimes,
        }),
        platformUrl: p.platformUrl,
      };
    },
  );
  const filtered = opts.contentKind
    ? slim.filter((p) => p.contentKind === opts.contentKind)
    : slim;
  return rankHits(filtered, { tags: [], keywords: [] }).slice(0, limit);
}
