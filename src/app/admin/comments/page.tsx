import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listCommentsForModeration } from "@/lib/engagement/comments";
import { CommentsModerationClient } from "./CommentsModerationClient";

export const dynamic = "force-dynamic";

export default async function AdminCommentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (session?.user?.role !== "admin") redirect("/login");

  const { status } = await searchParams;
  const filter =
    status === "PUBLISHED" || status === "HIDDEN" ? status : undefined;

  const initial = await listCommentsForModeration({ status: filter });

  return (
    <div className="px-6 py-8">
      <div className="mb-4">
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Comments</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Subscriber comments on the public archive. Hide a comment to take it
          out of public view (body retained for audit). Restore reverses.
        </p>
      </div>
      <CommentsModerationClient initial={initial} initialStatus={filter ?? null} />
    </div>
  );
}
