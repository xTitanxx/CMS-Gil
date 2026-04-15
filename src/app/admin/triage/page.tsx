import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TriageFeed } from "./TriageFeed";

export const metadata = { title: "Triage — CMS Gil" };

export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const sp = await searchParams;
  const bucket = typeof sp.bucket === "string" ? sp.bucket : undefined;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Triage</h1>
        <p className="mt-1 text-sm text-gray-500">
          Fix or dismiss posts that aren&apos;t ready to publish.
        </p>
      </div>
      <TriageFeed initialBucket={bucket} />
    </div>
  );
}
