/**
 * Build a thumbnail URL for a media item. With Blob storage, storageKey
 * is a full URL. For videos, derive the poster URL by replacing the
 * extension with ".poster.jpg". For images, return the URL as-is and
 * rely on next/image for display-time resize.
 */
export function buildThumbUrl(
  storageKey: string | null | undefined,
  mimeType: string | null | undefined
): string | null {
  if (!storageKey) return null;
  const isVideo = mimeType?.startsWith("video/");
  if (isVideo) {
    return storageKey.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return storageKey;
}
