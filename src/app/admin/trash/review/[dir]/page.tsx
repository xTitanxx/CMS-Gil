import Link from "next/link";
import { notFound } from "next/navigation";
import { v2 as cloudinary } from "cloudinary";
import { getReviewBatch } from "@/lib/trash-review";
import { ReviewClient } from "./ReviewClient";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const dynamic = "force-dynamic";

function thumbUrl(storageKey: string | null, mimeType: string | null): string | null {
  if (!storageKey) return null;
  const publicId = storageKey.replace(/\.[^/.]+$/, "");
  const isVideo = mimeType?.startsWith("video");
  return cloudinary.url(publicId, {
    resource_type: isVideo ? "video" : "image",
    type: "upload",
    format: "jpg",
    transformation: [{ width: 384, crop: "limit", quality: "auto" }],
  });
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
