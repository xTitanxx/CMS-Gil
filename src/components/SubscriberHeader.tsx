import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth, signOut } from "@/lib/auth";

export async function SubscriberHeader() {
  const session = await auth();
  const role = session?.user?.role;

  if (role === "subscriber" && session) {
    return (
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span className="truncate text-gray-700">
            Hi, <span className="font-semibold">{session.user.name}</span>
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <Sparkles className="h-3 w-3" />
              Talk to Virtual Gil
            </Link>
            <Link
              href="/bookmarks"
              className="text-blue-600 hover:underline"
            >
              Bookmarks
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/welcome" });
              }}
            >
              <button type="submit" className="text-blue-600 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // Admins on public pages: show a slim header with the same actions a
  // subscriber gets — bookmarks + sign out — so engagement features (like,
  // bookmark, comment) are testable without logging out and back in. Their
  // actions write to a hidden "[admin]" shadow subscriber row, kept distinct
  // from real subscriber data.
  if (role === "admin" && session) {
    return (
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span className="truncate text-gray-700">
            <span className="font-semibold">{session.user.name}</span>
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              admin
            </span>
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/admin"
              className="text-gray-600 hover:underline"
            >
              Admin
            </Link>
            <Link
              href="/chat"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <Sparkles className="h-3 w-3" />
              Talk to Virtual Gil
            </Link>
            <Link
              href="/bookmarks"
              className="text-blue-600 hover:underline"
            >
              Bookmarks
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Anonymous visitor: sign-in entry point so the chat is reachable from
  // anywhere on the archive.
  return (
    <div className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-end gap-2 px-4 py-2 text-sm">
        <Link
          href="/welcome"
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          <Sparkles className="h-3 w-3" />
          Talk to Virtual Gil
        </Link>
      </div>
    </div>
  );
}
