import Link from "next/link";
import { MessageCircle, Heart } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";
import { BackButton } from "./BackButton";

export const dynamic = "force-dynamic";

const SUBSCRIBE_URL =
  "https://www.facebook.com/gil.alter.7/support/?surface=permalink_become_supporter_url&entrypoint_surface=comet_permalink";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  // PR #56 security guard: reject `//evil.example` and `https://evil.example`
  // open-redirects. Allow same-origin paths only; default to `/` so users who
  // landed here from clicking Like/Save/Comment go back to the archive.
  const rawNext = (await searchParams).next ?? "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  if (session) redirect(next);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-6 sm:max-w-xl sm:py-10">
        {/* Top utility bar */}
        <div className="mb-6 flex items-center justify-between">
          <BackButton next={next} />
          <Link
            href="/"
            className="text-sm text-gray-600 hover:text-gray-900 hover:underline"
          >
            Browse the archive
          </Link>
        </div>

        {/* Header / hero */}
        <div className="mb-8 flex flex-col items-center text-center sm:mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatar.jpg"
            alt="Gil Alter"
            className="mb-4 h-20 w-20 rounded-full object-cover shadow ring-2 ring-white sm:h-24 sm:w-24"
          />
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Sign in
          </h1>
          <p className="mt-2 max-w-sm text-sm text-gray-600 sm:text-base">
            Some things on the site need a sign-in. Right now that&rsquo;s
            limited to subscribers — it may open up to everyone later.
          </p>
        </div>

        {/* Sign-in card */}
        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">
            Subscribers, sign in
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Enter the access code Gil sent you on Messenger.
          </p>
          <div className="mt-4">
            <SignInForm next={next} />
          </div>
        </section>

        {/* Subscribe explainer */}
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">
            Don&rsquo;t have a code yet?
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Become a supporter on Facebook. Once you do, Gil will send your
            access code on Messenger.
          </p>
          <a
            href={SUBSCRIBE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto"
          >
            Subscribe on Facebook
          </a>
        </section>

        {/* What signing in unlocks */}
        <section className="mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">
            What signing in unlocks
          </h2>

          <div className="mt-4 flex gap-3">
            <MessageCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-blue-600"
              aria-hidden
            />
            <div className="text-sm text-gray-700">
              <p className="font-medium text-gray-900">Talk to the Archivist</p>
              <p className="mt-1">
                Free to use. This feature runs on AI technology that has a real
                cost per message. I offer it at cost, with no profit — just to
                make it accessible.
              </p>
              <p className="mt-2">
                To keep it sustainable, usage is limited. If you need more
                access, I can increase the limit and adjust it based on the
                actual cost.
              </p>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Heart
              className="mt-0.5 h-5 w-5 shrink-0 text-red-500"
              aria-hidden
            />
            <div className="text-sm text-gray-700">
              <p className="font-medium text-gray-900">
                Like, comment, and save bookmarks
              </p>
              <p className="mt-1">
                React to posts, leave comments, and save anything you want to
                come back to.
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-auto pt-10 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Gil Alter. Facebook Archive.
        </footer>
      </div>
    </main>
  );
}
