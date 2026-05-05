// src/lib/public-posts.ts
import { prisma } from "@/lib/prisma";

export interface PublicPostMedia {
  id: string;
  storageKey: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  hasAudio: boolean | null;
  audioTrack: { storageKey: string } | null;
}

export interface PublicPost {
  id: string;
  body: string;
  bodyNormalized: string;
  originalDate: Date;
  tags: string[];
  sourceId: string | null;
  likeCount: number;
  media: PublicPostMedia[];
}

export function isStory(sourceId: string | null | undefined): boolean {
  return !!sourceId && sourceId.startsWith("fb_story_");
}

/**
 * Remove posts whose bodyNormalized matches an earlier post.
 * Among duplicates, keep the oldest (earliest originalDate).
 * Posts with empty bodyNormalized are never deduped.
 * Returns posts in originalDate descending order.
 */
export function dedupePosts(posts: PublicPost[]): PublicPost[] {
  const byBody = new Map<string, PublicPost>();
  const nonDedupable: PublicPost[] = [];

  for (const p of posts) {
    if (!p.bodyNormalized) {
      nonDedupable.push(p);
      continue;
    }
    const existing = byBody.get(p.bodyNormalized);
    if (!existing || p.originalDate < existing.originalDate) {
      byBody.set(p.bodyNormalized, p);
    }
  }

  const result = [...byBody.values(), ...nonDedupable];
  result.sort((a, b) => b.originalDate.getTime() - a.originalDate.getTime());
  return result;
}

const PAGE_SIZE = 20;

export async function getPublicFeedPage(cursor?: {
  date: Date;
  id: string;
}): Promise<{ posts: PublicPost[]; nextCursor: { date: Date; id: string } | null }> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  // Fetch a larger window than needed, so that after dedup we still have enough
  // for a full page. 3x page size is a pragmatic buffer.
  const fetchSize = PAGE_SIZE * 3;

  const where = cursor
    ? {
        userId: gilUserId,
        NOT: { sourceId: { startsWith: "fb_story_" } },
        OR: [
          { originalDate: { lt: cursor.date } },
          { originalDate: cursor.date, id: { lt: cursor.id } },
        ],
      }
    : { userId: gilUserId, NOT: { sourceId: { startsWith: "fb_story_" } } };

  const raw = await prisma.post.findMany({
    where,
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
      likeCount: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
      },
    },
    orderBy: [{ originalDate: "desc" }, { id: "desc" }],
    take: fetchSize,
  });

  const deduped = dedupePosts(raw);
  const page = deduped.slice(0, PAGE_SIZE);

  const nextCursor =
    page.length === PAGE_SIZE
      ? { date: page[page.length - 1].originalDate, id: page[page.length - 1].id }
      : null;

  return { posts: page, nextCursor };
}

export async function getPublicPost(id: string): Promise<PublicPost | null> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const post = await prisma.post.findFirst({
    where: { id, userId: gilUserId },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
      likeCount: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
      },
    },
  });

  return post;
}

export async function getRelatedPosts(
  post: PublicPost,
  limit = 5
): Promise<PublicPost[]> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  if (post.tags.length === 0) {
    // No tags — fall back to chronologically adjacent posts.
    const candidates = await prisma.post.findMany({
      where: { userId: gilUserId, id: { not: post.id } },
      select: {
        id: true,
        body: true,
        bodyNormalized: true,
        originalDate: true,
        tags: true,
        sourceId: true,
        likeCount: true,
        media: {
          select: {
            id: true,
            storageKey: true,
            mimeType: true,
            width: true,
            height: true,
            altText: true,
            hasAudio: true,
            audioTrack: { select: { storageKey: true } },
          },
        },
      },
      orderBy: { originalDate: "desc" },
      take: limit * 3,
    });
    return dedupePosts(candidates).slice(0, limit);
  }

  // Find candidates sharing any tag, then rank by overlap count.
  const candidates = await prisma.post.findMany({
    where: {
      userId: gilUserId,
      id: { not: post.id },
      tags: { hasSome: post.tags },
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
      likeCount: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
      },
    },
    take: limit * 5,
  });

  const scored = candidates
    .map((c) => ({
      post: c,
      overlap: c.tags.filter((t) => post.tags.includes(t)).length,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.post.originalDate.getTime() - a.post.originalDate.getTime());

  return dedupePosts(scored.map((s) => s.post)).slice(0, limit);
}

export async function getPublicStoriesPage(cursor?: {
  date: Date;
  id: string;
}): Promise<{ stories: PublicPost[]; nextCursor: { date: Date; id: string } | null }> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const pageSize = 30;

  const where = cursor
    ? {
        userId: gilUserId,
        sourceId: { startsWith: "fb_story_" },
        OR: [
          { originalDate: { lt: cursor.date } },
          { originalDate: cursor.date, id: { lt: cursor.id } },
        ],
      }
    : { userId: gilUserId, sourceId: { startsWith: "fb_story_" } };

  const stories = await prisma.post.findMany({
    where,
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
      likeCount: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
      },
    },
    orderBy: [{ originalDate: "desc" }, { id: "desc" }],
    take: pageSize,
  });

  const filtered = stories.filter((s) => s.media.length > 0);

  const nextCursor =
    stories.length === pageSize
      ? {
          date: stories[stories.length - 1].originalDate,
          id: stories[stories.length - 1].id,
        }
      : null;

  return { stories: filtered, nextCursor };
}

export async function getPublicStory(id: string): Promise<PublicPost | null> {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const story = await prisma.post.findFirst({
    where: {
      id,
      userId: gilUserId,
      sourceId: { startsWith: "fb_story_" },
    },
    select: {
      id: true,
      body: true,
      bodyNormalized: true,
      originalDate: true,
      tags: true,
      sourceId: true,
      likeCount: true,
      media: {
        select: {
          id: true,
          storageKey: true,
          mimeType: true,
          width: true,
          height: true,
          altText: true,
          hasAudio: true,
          audioTrack: { select: { storageKey: true } },
        },
      },
    },
  });

  return story;
}
