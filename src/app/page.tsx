import Link from "next/link";
import { getPublicFeedPage, getPublicStoriesPage } from "@/lib/public-posts";
import { getMediaUrl, getThumbnailUrl } from "@/lib/storage";
import { PublicFeed } from "./PublicFeed";
import { StoriesRow } from "./StoriesRow";

export const dynamic = "force-dynamic";

const BIO =
  "Rolling through life on wheels | Taking on daily challenges to fight darkness | Sharing real moments";
const COVER_SRC = "/banner.jpg";
const AVATAR_SRC = "/avatar.jpg";

export default async function HomePage() {
  const [feed, storiesPage] = await Promise.all([
    getPublicFeedPage(),
    getPublicStoriesPage(),
  ]);

  const postsWithUrls = await Promise.all(
    feed.posts.map(async (p) => ({
      id: p.id,
      body: p.body,
      originalDate: p.originalDate.toISOString(),
      tags: p.tags,
      media: await Promise.all(
        p.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          altText: m.altText,
          hasAudio: m.hasAudio,
          url: await getMediaUrl(m).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  const storiesWithUrls = await Promise.all(
    storiesPage.stories.map(async (s) => {
      const mediaWithUrls = await Promise.all(
        s.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          hasAudio: m.hasAudio,
          url: await getMediaUrl(m).catch(() => null),
        }))
      );
      const firstMedia = s.media[0];
      const thumbUrl = firstMedia
        ? await getThumbnailUrl(firstMedia.storageKey, firstMedia.mimeType).catch(() => null)
        : null;
      return {
        id: s.id,
        originalDate: s.originalDate.toISOString(),
        thumbUrl,
        media: mediaWithUrls,
      };
    })
  );

  const initialFeed = {
    posts: postsWithUrls,
    nextCursor: feed.nextCursor
      ? { date: feed.nextCursor.date.toISOString(), id: feed.nextCursor.id }
      : null,
  };

  const initialStories = {
    stories: storiesWithUrls,
    nextCursor: storiesPage.nextCursor
      ? {
          date: storiesPage.nextCursor.date.toISOString(),
          id: storiesPage.nextCursor.id,
        }
      : null,
  };

  const sidebarPhotos = postsWithUrls
    .flatMap((p) =>
      p.media
        .filter((m) => m.url && m.mimeType.startsWith("image/"))
        .map((m) => m.url as string)
    )
    .slice(0, 9);

  return (
    <main className="min-h-screen bg-gray-100">
      {/* Full-bleed banner */}
      <div className="h-48 w-full bg-gray-300 sm:h-64 md:h-80 lg:h-96">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={COVER_SRC}
          alt=""
          className="block h-full w-full max-w-none object-cover"
        />
      </div>

      {/* Profile header */}
      <div className="bg-white">
        <div className="mx-auto max-w-5xl">
          <div className="flex items-center gap-4 px-6 py-3">
            <div className="relative z-10 -mt-12">
              <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-white bg-gray-200 shadow ring-2 ring-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={AVATAR_SRC}
                  alt="Gil Alter"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold leading-tight text-gray-900">
                Gil Alter
              </h1>
              <p className="text-sm text-gray-600">{BIO}</p>
            </div>
          </div>

        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="space-y-4">
            {sidebarPhotos.length > 0 && (
              <section className="rounded-xl bg-white p-4 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900">Photos</h2>
                  <span className="text-sm font-medium text-blue-600 hover:underline">
                    See all photos
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {sidebarPhotos.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt=""
                      className="aspect-square w-full rounded object-cover"
                    />
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* Feed column */}
          <div className="min-w-0 space-y-4">
            <section className="rounded-xl bg-white shadow-sm overflow-hidden">
              <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
                <p className="text-xs font-medium text-amber-800">
                  Experimental feature — Virtual Gil is an AI that generates responses based on
                  Gil&apos;s posts. It is not Gil, may not always be accurate, and does not
                  provide medical advice.
                </p>
              </div>
              <div className="px-4 py-4">
                <h2 className="text-base font-bold text-gray-900">Talk to Virtual Gil</h2>
                <p className="mt-1.5 text-sm text-gray-600">
                  Trained on Gil&rsquo;s archive.<br />
                  Ask anything &mdash; if it exists, it will dig it up.
                </p>
                <Link
                  href="/chat"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors"
                >
                  Try it out
                </Link>
              </div>
            </section>

            <StoriesRow initial={initialStories} />
            <PublicFeed initial={initialFeed} />
          </div>
        </div>
      </div>

      <footer className="py-6 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} Gil Alter. Facebook Archive.
      </footer>
    </main>
  );
}
