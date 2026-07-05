import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search-normalize";
import { embedQuery, toPgVectorLiteral } from "./embed";

export interface PublicSearchHit {
  id: string;
  body: string;
  originalDate: string; // ISO
  tags: string[];
  likeCount: number;
  media: {
    id: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    altText: string | null;
    hasAudio: boolean | null;
    audioTrackId?: string | null;
    url: string | null;
  }[];
}

const RRF_K = 60;
const PER_RETRIEVER_LIMIT = 50;

interface RankedId {
  id: string;
  rank: number;
}

// Exported for unit tests.
export function reciprocalRankFusion(lists: RankedId[][]): string[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (const { id, rank } of list) {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (RRF_K + rank + 1));
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
}

async function vectorCandidates(
  userId: string,
  queryVec: number[],
): Promise<RankedId[]> {
  const vec = toPgVectorLiteral(queryVec);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Post"
    WHERE "userId" = ${userId}
      AND embedding IS NOT NULL
      AND readiness != 'ARCHIVED'
      AND share IS NULL
      AND "postType"::text = 'POST'
    ORDER BY embedding <=> ${vec}::vector
    LIMIT ${PER_RETRIEVER_LIMIT}
  `;
  return rows.map((r, i) => ({ id: r.id, rank: i }));
}

async function phraseCandidates(
  userId: string,
  query: string,
): Promise<RankedId[]> {
  const normalized = normalizeForSearch(query);
  if (normalized.length < 4) return [];
  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      postType: "POST",
      bodyNormalized: { contains: normalized },
    },
    select: { id: true },
    orderBy: { originalDate: "desc" },
    take: PER_RETRIEVER_LIMIT,
  });
  return rows.map((r, i) => ({ id: r.id, rank: i }));
}

const POST_SELECT = {
  id: true,
  body: true,
  originalDate: true,
  tags: true,
  likeCount: true,
  media: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      storageKey: true,
      mimeType: true,
      width: true,
      height: true,
      altText: true,
      hasAudio: true,
      audioTrackId: true,
    },
  },
} as const;

function rowToHit(r: {
  id: string;
  body: string;
  originalDate: Date;
  tags: string[];
  likeCount: number;
  media: {
    id: string;
    storageKey: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    altText: string | null;
    hasAudio: boolean | null;
    audioTrackId: string | null;
  }[];
}): PublicSearchHit {
  return {
    id: r.id,
    body: r.body,
    originalDate: r.originalDate.toISOString(),
    tags: r.tags,
    likeCount: r.likeCount,
    media: r.media.map((m) => ({
      id: m.id,
      mimeType: m.mimeType,
      width: m.width,
      height: m.height,
      altText: m.altText,
      hasAudio: m.hasAudio,
      audioTrackId: m.audioTrackId,
      url: m.storageKey,
    })),
  };
}

async function hydrateIds(ids: string[]): Promise<PublicSearchHit[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.post.findMany({
    where: { id: { in: ids } },
    select: POST_SELECT,
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map(rowToHit);
}

async function recentPosts(userId: string, limit: number): Promise<PublicSearchHit[]> {
  const rows = await prisma.post.findMany({
    where: {
      userId,
      readiness: { not: "ARCHIVED" },
      share: { equals: Prisma.DbNull },
      postType: "POST",
    },
    select: POST_SELECT,
    orderBy: { originalDate: "desc" },
    take: limit,
  });
  return rows.map(rowToHit);
}

/**
 * Public semantic search over Gil's post archive.
 * Query < 2 chars → returns most recent posts (no API calls).
 * Otherwise: Voyage embed + pgvector cosine + phrase match, merged via RRF.
 * No Haiku calls — keeps marginal cost near zero.
 */
export async function publicSearch(
  userId: string,
  query: string,
  limit = 20,
): Promise<PublicSearchHit[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return recentPosts(userId, limit);

  const [queryVec, phraseHits] = await Promise.all([
    embedQuery(trimmed),
    phraseCandidates(userId, trimmed),
  ]);

  const vectorHits = queryVec
    ? await vectorCandidates(userId, queryVec)
    : [];

  const merged = reciprocalRankFusion([vectorHits, phraseHits]).slice(0, limit);
  return hydrateIds(merged);
}
