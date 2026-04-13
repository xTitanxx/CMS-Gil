import { getPublicFeedPage } from "@/lib/public-posts";
import { getSignedDownloadUrl } from "@/lib/storage";
import { PublicFeed } from "./PublicFeed";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { posts, nextCursor } = await getPublicFeedPage();

  const postsWithUrls = await Promise.all(
    posts.map(async (p) => ({
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
          url: await getSignedDownloadUrl(m.storageKey, 3600, m.mimeType).catch(
            () => null
          ),
        }))
      ),
    }))
  );

  const initial = {
    posts: postsWithUrls,
    nextCursor: nextCursor
      ? { date: nextCursor.date.toISOString(), id: nextCursor.id }
      : null,
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-xl mx-auto px-4 py-6">
        <header className="flex items-center gap-3 mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white font-semibold text-lg">
            G
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Gil Alter</h1>
            <p className="text-xs text-gray-500">Posts about MS, breathwork, depression, and more</p>
          </div>
        </header>
        <PublicFeed initial={initial} />
      </div>
    </main>
  );
}
