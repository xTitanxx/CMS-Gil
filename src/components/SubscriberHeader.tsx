import Link from "next/link";
import { Sparkles } from "lucide-react";
import { auth, signOut } from "@/lib/auth";

export async function SubscriberHeader() {
  const session = await auth();
  const role = session?.user?.role;

  if (role === "subscriber") {
    return (
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
          <span className="text-gray-700">
            Hi, <span className="font-semibold">{session?.user?.name}</span>
          </span>
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <Sparkles className="h-3 w-3" />
              Talk to Virtual Gil
            </Link>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
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

  // Admins: keep the public archive uncluttered — they have their own chrome.
  if (role === "admin") return null;

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
