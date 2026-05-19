import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMediaUrl } from "@/lib/storage";
import { SubscriberHeader } from "@/components/SubscriberHeader";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";
import { BookmarksList, type BookmarkedPost } from "./BookmarksList";

export const dynamic = "force-dynamic";

export default async function BookmarksPage() {
  const session = await auth();
  // Admin sees their own shadow-subscriber bookmarks here. Real subscribers
  // see their own. Anyone else: redirect to /welcome.
  const subscriberId = await resolveActorSubscriberId(session);
  if (!subscriberId) {
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
        readiness: "READY",
        NOT: { sourceId: { startsWith: "fb_story_" } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      createdAt: true,
      post: {
        select: {
          id: true,
          body: true,
          originalDate: true,
          tags: true,
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
      },
    },
  });

  const items: BookmarkedPost[] = await Promise.all(
    bookmarks.map(async (b) => ({
      id: b.post.id,
      body: b.post.body,
      originalDate: b.post.originalDate.toISOString(),
      tags: b.post.tags,
      likeCount: b.post.likeCount,
      bookmarkedAt: b.createdAt.toISOString(),
      media: await Promise.all(
        b.post.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          hasAudio: m.hasAudio,
          audioTrackId: m.audioTrack?.storageKey ? m.id : null,
          url: await getMediaUrl(m).catch(() => null),
        })),
      ),
    })),
  );

  const signedIn = session?.user?.role === "subscriber" || session?.user?.role === "admin";

  return (
    <main className="min-h-screen bg-gray-100">
      <SubscriberHeader />
      <div className="mx-auto max-w-2xl px-3 py-4 md:px-4 md:py-6">
        <h1 className="mb-3 text-xl font-bold text-gray-900">Your bookmarks</h1>
        <BookmarksList initial={items} signedIn={signedIn} />
      </div>
    </main>
  );
}
