"use client";

import { upload } from "@vercel/blob/client";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;

export interface UploadedMedia {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
}

export async function uploadPostMedia(postId: string, file: File): Promise<UploadedMedia> {
  if (file.size < DIRECT_UPLOAD_LIMIT) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/posts/${postId}/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
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
  return (await res.json()) as UploadedMedia;
}
