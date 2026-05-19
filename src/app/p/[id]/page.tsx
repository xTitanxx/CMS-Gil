import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getPublicPost,
  getRelatedPosts,
  pickOgImage,
  postExcerpt,
} from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";
import { getLikedPostIds } from "@/lib/engagement/like";
import { getBookmarkedPostIds } from "@/lib/engagement/bookmark";
import { listComments } from "@/lib/engagement/comments";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";
import { BackButton } from "./BackButton";
import { SubscriberHeader } from "@/components/SubscriberHeader";
import { CommentSection } from "@/components/CommentSection";
import { PostCardClient } from "./PostCardClient";
import { RelatedPostsList, type RelatedPostSummary } from "./RelatedPostsList";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const post = await getPublicPost(id);
  if (!post) return {};

  const dateLabel = formatDate(post.originalDate);
  const hasBody = post.body.trim().length > 0;
  const title = hasBody ? postExcerpt(post.body, 70) : `Post from ${dateLabel}`;
  const description = hasBody
    ? postExcerpt(post.body, 180)
    : `An archived post by Gil Alter from ${dateLabel}.`;

  const og = await pickOgImage(post.media);
  const url = `/p/${post.id}`;

  return {
    title,
    description,
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: "Gil Alter",
      publishedTime: post.originalDate.toISOString(),
      images: og
        ? [{ url: og.url, width: og.width, height: og.height, alt: og.alt }]
        : undefined,
    },
    twitter: {
      card: og ? "summary_large_image" : "summary",
      title,
      description,
      images: og ? [og.url] : undefined,
    },
    alternates: { canonical: url },
  };
}

export default async function PublicPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [session, post] = await Promise.all([auth(), getPublicPost(id)]);
  if (!post) notFound();

  const related = await getRelatedPosts(post, 5);

  // Admin acts under their shadow subscriber so they can test engagement
  // features end-to-end without logging out. See lib/engagement/admin-shadow.ts.
  const actorSubscriberId = await resolveActorSubscriberId(session);
  const signedIn = !!actorSubscriberId;
  const likedPromise: Promise<string[]> =
    actorSubscriberId ? getLikedPostIds(actorSubscriberId, [post.id]) : Promise.resolve([]);
  const bookmarkedPromise: Promise<string[]> =
    actorSubscriberId ? getBookmarkedPostIds(actorSubscriberId, [post.id]) : Promise.resolve([]);
  const viewerSubscriberPromise =
    actorSubscriberId
      ? prisma.subscriber.findUnique({
          where: { id: actorSubscriberId },
          select: { commentsDisabledAt: true },
        })
      : Promise.resolve(null);

  const [likedIds, bookmarkedIds, initialComments, viewerSubscriber] = await Promise.all([
    likedPromise,
    bookmarkedPromise,
    listComments(post.id, null, actorSubscriberId ?? null),
    viewerSubscriberPromise,
  ]);

  const mainMediaWithUrls = await Promise.all(
    post.media.map(async (m) => ({
      id: m.id,
      mimeType: m.mimeType,
      width: m.width,
      height: m.height,
      altText: m.altText,
      hasAudio: m.hasAudio,
      audioTrackId: m.audioTrack?.storageKey ? m.id : null,
      url: await getMediaUrl(m).catch(() => null),
    })),
  );

  const relatedSummaries: RelatedPostSummary[] = await Promise.all(
    related.map(async (r) => {
      const firstMedia = r.media[0] ?? null;
      const thumbUrl = firstMedia
        ? await getMediaUrl(firstMedia).catch(() => null)
        : null;
      return {
        id: r.id,
        body: r.body,
        originalDate: r.originalDate.toISOString(),
        thumbUrl,
        thumbAlt: firstMedia?.altText ?? null,
        thumbIsVideo: !!firstMedia?.mimeType.startsWith("video/"),
      };
    }),
  );

  return (
    <main className="min-h-screen bg-gray-100">
      <SubscriberHeader />
      <div className="mx-auto max-w-2xl px-3 py-4 md:px-4 md:py-6">
        <div className="mb-3">
          <BackButton />
        </div>

        <PostCardClient
          post={{
            id: post.id,
            body: post.body,
            originalDate: post.originalDate.toISOString(),
            tags: post.tags,
            likeCount: post.likeCount,
            media: mainMediaWithUrls,
          }}
          initialLiked={likedIds.includes(post.id)}
          initialBookmarked={bookmarkedIds.includes(post.id)}
          signedIn={signedIn}
        />

        <div className="mt-3 overflow-hidden rounded-lg bg-white shadow-sm">
          <CommentSection
            postId={post.id}
            signedIn={signedIn}
            commentsDisabled={!!viewerSubscriber?.commentsDisabledAt}
            initialComments={initialComments}
          />
        </div>

        <RelatedPostsList posts={relatedSummaries} />
      </div>
    </main>
  );
}
