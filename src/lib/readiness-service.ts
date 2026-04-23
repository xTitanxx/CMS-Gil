import { prisma } from "./prisma";
import { computeReadiness } from "./readiness";

export async function refreshReadiness(postId: string): Promise<void> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { media: true },
  });
  if (!post) return;
  if (post.readiness === "ARCHIVED") return;

  const { readiness, reasons } = computeReadiness(
    {
      body: post.body,
      share: post.share,
      readiness: post.readiness,
      notReadyReasons: post.notReadyReasons,
    },
    post.media.map((m) => ({ mimeType: m.mimeType, hasAudio: m.hasAudio }))
  );

  await prisma.post.update({
    where: { id: postId },
    data: {
      readiness,
      notReadyReasons: reasons,
      readinessCheckedAt: new Date(),
    },
  });
}
