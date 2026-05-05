import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";

export const dynamic = "force-dynamic";

const SUBSCRIBE_URL =
  "https://www.facebook.com/gil.alter.7/support/?surface=permalink_become_supporter_url&entrypoint_surface=comet_permalink";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  // PR #55 intent: default to /chat (push subscribers toward Virtual Gil).
  // PR #56 security guard: reject `//evil.example` and `https://evil.example`
  // open-redirects. Combined: default /chat, allow same-origin paths only.
  const rawNext = (await searchParams).next ?? "/chat";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/chat";
  if (session) redirect(next);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8 sm:max-w-xl sm:py-12">
        {/* Header / hero */}
        <div className="mb-8 flex flex-col items-center text-center sm:mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatar.jpg"
            alt="Gil Alter"
            className="mb-4 h-20 w-20 rounded-full object-cover shadow ring-2 ring-white sm:h-24 sm:w-24"
          />
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
            Talk to Virtual Gil
          </h1>
          <p className="mt-2 max-w-sm text-sm text-gray-600 sm:text-base">
            Trained on Gil&rsquo;s archive.
            <br />
            Ask anything &mdash; if it exists, it will dig it up.
          </p>
        </div>

        {/* Sign-in card */}
        <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-base font-semibold text-gray-900 sm:text-lg">
            Subscribers, sign in
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            Enter the access code Gil sent you.
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
            Virtual Gil is for Gil&rsquo;s Facebook subscribers. Become a
            supporter on Facebook, then message Gil for your access code.
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

        {/* Public archive escape hatch */}
        <div className="mt-6 text-center">
          <Link
            href="/"
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← Just want to read? Browse the archive
          </Link>
        </div>

        <footer className="mt-auto pt-10 text-center text-xs text-gray-400">
          © {new Date().getFullYear()} Gil Alter. Facebook Archive.
        </footer>
      </div>
    </main>
  );
}
