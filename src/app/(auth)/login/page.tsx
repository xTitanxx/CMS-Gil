import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SignInButtons } from "./SignInButtons";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/admin/dashboard");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-gray-900">CMS Gil</h1>
          <p className="mt-1 text-sm text-gray-500">Sign in to your content hub</p>
        </div>
        <SignInButtons />
      </div>
    </div>
  );
}
