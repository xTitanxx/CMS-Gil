import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInButtons } from "./SignInButtons";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role === "admin") redirect("/admin/planner");
  if (session?.user?.role === "subscriber") redirect("/");

  const params = await searchParams;
  const denied = params.error === "AccessDenied";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">Gil Alter</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your content hub</p>
        </div>
        {denied && (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            That account isn&apos;t authorized to sign in here.
          </p>
        )}
        <SignInButtons />
      </div>
    </div>
  );
}
