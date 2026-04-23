import Link from "next/link";
import { notFound } from "next/navigation";
import { getReviewBatch } from "@/lib/trash-review";
import { ReviewClient } from "./ReviewClient";

export const dynamic = "force-dynamic";

function thumbUrl(storageKey: string | null, mimeType: string | null): string | null {
  if (!storageKey) return null;
  const isVideo = mimeType?.startsWith("video");
  if (isVideo) {
    return storageKey.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return storageKey;
}

export default async function ReviewBatchPage({
  params,
}: {
  params: Promise<{ dir: string }>;
}) {
  const { dir } = await params;
  const batch = await getReviewBatch(dir);
  if (!batch) return notFound();

  // Pre-compute thumbnail URLs for keep + each drop.
  const groups = batch.groups.map((g) => ({
    id: g.id,
    keep: {
      ...g.keep,
      thumbUrl: thumbUrl(g.keep.storageKey, g.keep.mimeType),
    },
    drops: g.drops.map((d) => ({
      ...d,
      thumbUrl: thumbUrl(d.storageKey, d.mimeType),
    })),
  }));

  return (
    <ReviewClient dir={dir} createdAt={batch.createdAt} groups={groups} />
  );
}
