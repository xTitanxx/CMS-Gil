import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ManualPostHelper } from "./ManualPostHelper";

export const metadata = { title: "Post manually" };

export default async function ManualPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect(`/api/auth/signin?callbackUrl=/admin/m/${postId}`);

  const post = await prisma.post.findFirst({
    where: { id: postId, userId: session.user!.id! },
    select: {
      id: true,
      body: true,
      originalDate: true,
      platformUrl: true,
      media: {
        select: { id: true, mimeType: true, storageKey: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!post) notFound();

  return (
    <ManualPostHelper
      postId={post.id}
      body={post.body ?? ""}
      originalDate={post.originalDate.toISOString()}
      platformUrl={post.platformUrl}
      media={post.media.map((m) => ({
        id: m.id,
        mimeType: m.mimeType,
        url: m.storageKey,
      }))}
    />
  );
}
