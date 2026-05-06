import { notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPublicPost, getRelatedPosts } from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";
import { getLikedPostIds } from "@/lib/engagement/like";
import { getBookmarkedPostIds } from "@/lib/engagement/bookmark";
import { listComments } from "@/lib/engagement/comments";
import { BackButton } from "./BackButton";
import { SubscriberHeader } from "@/components/SubscriberHeader";
import { EngagementBar } from "@/components/EngagementBar";
import { CommentSection } from "@/components/CommentSection";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function mediaWithUrls<T extends { storageKey: string; mimeType: string; id: string; altText: string | null }>(
  media: T[]
) {
  return Promise.all(
    media.map(async (m) => ({
      id: m.id,
      altText: m.altText,
      mimeType: m.mimeType,
      url: await getMediaUrl(m).catch(
        () => null
      ),
    }))
  );
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

  const subscriberId = session?.user?.subscriberId;
  const role = session?.user?.role;
  const signedIn = role === "subscriber";
  const likedPromise: Promise<string[]> =
    signedIn && subscriberId ? getLikedPostIds(subscriberId, [post.id]) : Promise.resolve([]);
  const bookmarkedPromise: Promise<string[]> =
    signedIn && subscriberId ? getBookmarkedPostIds(subscriberId, [post.id]) : Promise.resolve([]);
  const viewerSubscriberPromise =
    signedIn && subscriberId
      ? prisma.subscriber.findUnique({
          where: { id: subscriberId },
          select: { commentsDisabledAt: true },
        })
      : Promise.resolve(null);

  const [likedIds, bookmarkedIds, initialComments, viewerSubscriber] = await Promise.all([
    likedPromise,
    bookmarkedPromise,
    listComments(post.id, null, subscriberId ?? null),
    viewerSubscriberPromise,
  ]);

  const mainMedia = await mediaWithUrls(post.media);
  const relatedWithUrls = await Promise.all(
    related.map(async (r) => ({
      ...r,
      mediaWithUrls: await mediaWithUrls(r.media),
    }))
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <SubscriberHeader />
      <div className="max-w-xl mx-auto px-4 py-6">
        <div className="mb-4">
          <BackButton />
        </div>

        <article className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4">
            <p className="text-xs text-gray-500 mb-3">{formatDate(post.originalDate)}</p>
            <p className="text-sm text-gray-800 whitespace-pre-wrap mb-4">{post.body}</p>
            {mainMedia.length > 0 && (
              <div className="flex flex-col gap-2">
                {mainMedia.map((m) =>
                  m.url && m.mimeType.startsWith("video/") ? (
                    <video
                      key={m.id}
                      src={m.url}
                      controls
                      className="rounded max-w-full"
                      preload="metadata"
                    />
                  ) : m.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={m.id}
                      src={m.url}
                      alt={m.altText ?? ""}
                      className="rounded max-w-full h-auto"
                    />
                  ) : null
                )}
              </div>
            )}
          </div>
          <EngagementBar
            postId={post.id}
            initialLikeCount={post.likeCount}
            initialLiked={likedIds.includes(post.id)}
            initialBookmarked={bookmarkedIds.includes(post.id)}
            signedIn={signedIn}
          />
          <CommentSection
            postId={post.id}
            signedIn={signedIn}
            commentsDisabled={!!viewerSubscriber?.commentsDisabledAt}
            initialComments={initialComments}
          />
        </article>

        {relatedWithUrls.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Related posts</h2>
            <div className="flex flex-col gap-3">
              {relatedWithUrls.map((r) => (
                <Link
                  key={r.id}
                  href={`/p/${r.id}`}
                  className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                >
                  <p className="text-xs text-gray-500 mb-2">{formatDate(r.originalDate)}</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap line-clamp-3">
                    {r.body}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
