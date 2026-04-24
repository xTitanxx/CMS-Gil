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

  const blob = await upload(file.name, file, {
    access: "public",
    handleUploadUrl: "/api/blob",
  });
  const res = await fetch(`/api/posts/${postId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blobUrl: blob.url,
      filename: file.name,
      mimeType: file.type,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as UploadedMedia;
}
