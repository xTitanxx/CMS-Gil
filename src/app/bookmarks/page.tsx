import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";
import { SubscriberHeader } from "@/components/SubscriberHeader";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function BookmarksPage() {
  const session = await auth();
  const subscriberId = session?.user?.subscriberId;
  if (session?.user?.role !== "subscriber" || !subscriberId) {
    redirect("/welcome?next=/bookmarks");
  }

  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const bookmarks = await prisma.postBookmark.findMany({
    where: {
      subscriberId,
      // Only show bookmarks on posts that are still in the public archive.
      post: {
        userId: gilUserId,
        archivedAt: null,
        NOT: { sourceId: { startsWith: "fb_story_" } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      createdAt: true,
      post: {
        select: {
          id: true,
          body: true,
          originalDate: true,
          media: {
            select: {
              id: true,
              storageKey: true,
              mimeType: true,
              altText: true,
            },
          },
        },
      },
    },
  });

  const items = await Promise.all(
    bookmarks.map(async (b) => ({
      bookmarkedAt: b.createdAt,
      post: {
        id: b.post.id,
        body: b.post.body,
        originalDate: b.post.originalDate,
        firstMediaUrl:
          b.post.media[0]
            ? await getMediaUrl(b.post.media[0]).catch(() => null)
            : null,
        firstMediaMime: b.post.media[0]?.mimeType ?? null,
      },
    }))
  );

  return (
    <main className="min-h-screen bg-gray-50">
      <SubscriberHeader />
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="mb-4 text-xl font-bold text-gray-900">Your bookmarks</h1>
        {items.length === 0 ? (
          <p className="rounded-lg bg-white p-6 text-center text-sm text-gray-600 shadow-sm">
            You haven&rsquo;t saved any posts yet. Tap the{" "}
            <span className="font-semibold">Save</span> button on a post to add it
            here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map(({ post, bookmarkedAt }) => (
              <li key={post.id}>
                <Link
                  href={`/p/${post.id}`}
                  className="flex items-start gap-3 rounded-lg bg-white p-3 shadow-sm transition-colors hover:bg-gray-50"
                >
                  {post.firstMediaUrl &&
                  post.firstMediaMime?.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.firstMediaUrl}
                      alt=""
                      className="h-16 w-16 flex-shrink-0 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded bg-gray-100 text-xs text-gray-400">
                      {post.firstMediaMime?.startsWith("video/") ? "▶" : "—"}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-500">
                      Saved {formatDate(bookmarkedAt)} · Posted{" "}
                      {formatDate(post.originalDate)}
                    </p>
                    <p className="mt-1 line-clamp-3 text-sm text-gray-800">
                      {post.body}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
