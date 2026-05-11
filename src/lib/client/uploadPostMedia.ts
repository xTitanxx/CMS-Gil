"use client";

import { upload } from "@vercel/blob/client";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;

export interface UploadedMedia {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
}

export interface UploadOptions {
  // Called repeatedly with percent 0-100. Note: the small-file direct-POST
  // path can't measure browser fetch progress, so it just jumps 0 → 100.
  // The blob multipart path emits real percentages from @vercel/blob.
  onProgress?: (percent: number) => void;
}

export async function uploadPostMedia(
  postId: string,
  file: File,
  opts: UploadOptions = {},
): Promise<UploadedMedia> {
  const onProgress = opts.onProgress;

  if (file.size < DIRECT_UPLOAD_LIMIT) {
    onProgress?.(0);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/posts/${postId}/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    onProgress?.(100);
    return (await res.json()) as UploadedMedia;
  }

  // Use multipart for large files. A 55s iPhone video runs 50–150MB; the
  // default single-PUT path from @vercel/blob fails for files past ~100MB
  // (Vercel themselves recommend multipart above that). When the single PUT
  // rejected, the second fetch below never fired — the client just saw a
  // generic "failed to upload" with no server-side log because the request
  // never reached our function.
  let blob;
  try {
    blob = await upload(file.name, file, {
      access: "public",
      handleUploadUrl: "/api/blob",
      multipart: true,
      // Reserve the last 5% for the server-side attach step so the bar
      // doesn't sit at 100% while we're still waiting on R2 + DB write.
      onUploadProgress: ({ percentage }) =>
        onProgress?.(Math.round(percentage * 0.95)),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Blob upload failed: ${msg}`);
  }

  const res = await fetch(`/api/posts/${postId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blobUrl: blob.url,
      filename: file.name,
      mimeType: file.type,
    }),
  });
  if (!res.ok) throw new Error(`Media attach failed: ${await res.text()}`);
  onProgress?.(100);
  return (await res.json()) as UploadedMedia;
}
