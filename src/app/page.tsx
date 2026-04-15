import Link from "next/link";
import { getPublicFeedPage, getPublicStoriesPage } from "@/lib/public-posts";
import { getMediaUrl } from "@/lib/storage";
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
    storiesPage.stories.map(async (s) => ({
      id: s.id,
      originalDate: s.originalDate.toISOString(),
      media: await Promise.all(
        s.media.map(async (m) => ({
          id: m.id,
          mimeType: m.mimeType,
          hasAudio: m.hasAudio,
          url: await getMediaUrl(m).catch(
            () => null
          ),
        }))
      ),
    }))
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
            <Link
              href="/chat"
              className="hidden shrink-0 items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 sm:inline-flex"
            >
              @ Message
            </Link>
          </div>

        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          {/* Sidebar */}
          <aside className="space-y-4">
            <section className="rounded-xl bg-white p-4 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">Intro</h2>
              <p className="mt-2 text-sm text-gray-700">{BIO}</p>
            </section>

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
            <Link
              href="/chat"
              className="block rounded-xl bg-white p-3 shadow-sm hover:bg-gray-50"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-full bg-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={AVATAR_SRC}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="flex-1 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-500">
                  Write something to Gil…
                </span>
              </div>
            </Link>

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
