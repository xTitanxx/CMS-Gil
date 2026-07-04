import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SearchBar } from "./SearchBar";
import { publicSearch, type PublicSearchHit } from "@/lib/retrieval/public-search";

export const metadata = { title: "Search" };

const CAPTION_LIMIT = 220;

function SearchResultCard({ hit }: { hit: PublicSearchHit }) {
  const body = hit.body ?? "";
  const excerpt =
    body.length > CAPTION_LIMIT ? body.slice(0, CAPTION_LIMIT).trimEnd() + "…" : body;
  const date = new Date(hit.originalDate).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <Link
      href={`/p/${hit.id}`}
      className="block overflow-hidden rounded-lg bg-white shadow-sm transition-shadow hover:shadow-md"
    >
      {hit.thumbUrl && (
        <div className="h-48 w-full overflow-hidden bg-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={hit.thumbUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        </div>
      )}
      <div className="p-3">
        <p className="mb-1 text-xs text-gray-500">{date}</p>
        {excerpt && (
          <p className="break-words whitespace-pre-wrap text-[15px] leading-snug text-gray-900">
            {excerpt}
          </p>
        )}
        {hit.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {hit.tags.slice(0, 5).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 break-words"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const isSearch = query.length >= 2;

  const results = await publicSearch(gilUserId, query);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-2xl px-4 py-3">
          <Link
            href="/"
            className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Gil Alter
          </Link>
          <SearchBar initialQuery={query} />
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {isSearch && results.length === 0 && (
          <p className="break-words text-sm text-gray-500">
            No posts found for &ldquo;{query}&rdquo;. Try different words.
          </p>
        )}
        {!isSearch && (
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Recent posts
          </p>
        )}
        {results.map((hit) => (
          <SearchResultCard key={hit.id} hit={hit} />
        ))}
      </div>
    </main>
  );
}
