import { PageHeader } from "@/app/admin/_shared/PageHeader";
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
    <>
      <PageHeader
        title="Comments"
        subtitle="Subscriber comments on the public archive. Hide a comment to take it out of public view (body retained for audit). Restore reverses."
      />
      <CommentsModerationClient initial={initial} initialStatus={filter ?? null} />
    </>
  );
}
