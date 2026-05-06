import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth, signOut } from "@/lib/auth";

export async function SubscriberHeader() {
  const session = await auth();
  const role = session?.user?.role;

  if (role === "subscriber" && session) {
    return (
      <div
        className="border-b border-gray-200 bg-white"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 text-sm">
          <span className="min-w-0 truncate text-gray-700">
            Hi, <span className="font-semibold">{session.user.name}</span>
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
  // subscriber gets — Bookmarks, Talk to Virtual Gil, plus an "Admin" pill
  // and Sign out — so engagement features (like, bookmark, comment) are
  // testable without logging out and back in. Their actions write to a
  // hidden "[admin]" shadow subscriber row, kept distinct from real
  // subscriber data. Pulls in the iOS safe-area-inset-top from main so
  // the bar sits below the notch.
  if (role === "admin" && session) {
    return (
      <div
        className="border-b border-gray-200 bg-white"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 text-sm">
          <span className="min-w-0 truncate text-gray-700">
            <span className="font-semibold">{session.user.name}</span>
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
              admin
            </span>
          </span>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href="/admin"
              className="inline-flex items-center rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700"
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
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button type="submit" className="text-gray-600 hover:text-gray-900 hover:underline">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="border-b border-gray-200 bg-white"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <Link href="/welcome?next=/" className="text-gray-600 hover:text-gray-900 hover:underline">
          Sign in
        </Link>
        <Link
          href="/welcome?next=/chat"
          className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          <Sparkles className="h-3 w-3" />
          Talk to Virtual Gil
        </Link>
      </div>
    </div>
  );
}
