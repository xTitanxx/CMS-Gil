import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { SearchBar } from "./SearchBar";
import { SearchResults } from "./SearchResults";
import { publicSearch } from "@/lib/retrieval/public-search";

export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const gilUserId = process.env.GIL_USER_ID;
  if (!gilUserId) throw new Error("GIL_USER_ID is not set");

  const [{ q }, session] = await Promise.all([searchParams, auth()]);
  const query = q?.trim() ?? "";
  const isSearch = query.length >= 2;
  const signedIn = session?.user?.role === "subscriber";

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

      <div className="mx-auto max-w-2xl px-4 py-4">
        {isSearch && results.length === 0 && (
          <p className="mb-3 break-words text-sm text-gray-500">
            No posts found for &ldquo;{query}&rdquo;. Try different words.
          </p>
        )}
        {!isSearch && results.length > 0 && (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Recent posts
          </p>
        )}
        <SearchResults hits={results} isSearch={isSearch} signedIn={signedIn} />
      </div>
    </main>
  );
}
