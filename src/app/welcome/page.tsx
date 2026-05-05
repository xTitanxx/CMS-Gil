import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import SignInForm from "./SignInForm";

export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await auth();
  const rawNext = (await searchParams).next ?? "/";
  // Open-redirect guard: only allow same-origin paths. `//evil.example` and
  // `https://evil.example` both fail the second condition.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  if (session) redirect(next);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/avatar.jpg"
            alt="Gil Alter"
            className="mb-3 h-16 w-16 rounded-full object-cover ring-2 ring-white shadow"
          />
          <h1 className="text-xl font-bold text-gray-900">Welcome to Gil&apos;s archive</h1>
          <p className="mt-1 text-sm text-gray-600">
            Enter your access code to come in. If you don&apos;t have one,
            message Gil on Facebook.
          </p>
        </div>
        <SignInForm next={next} />
      </div>
    </main>
  );
}
