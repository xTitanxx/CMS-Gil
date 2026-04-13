export function buildThumbUrl(
  storageKey: string | null | undefined,
  mimeType: string | null | undefined
): string | null {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!storageKey || !cloudName) return null;

  const publicId = storageKey.replace(/\.[^.]+$/, "");
  const isVideo = mimeType?.startsWith("video/");

  if (isVideo) {
    return `https://res.cloudinary.com/${cloudName}/video/upload/c_fill,w_160,h_160,so_0/${publicId}.jpg`;
  }
  return `https://res.cloudinary.com/${cloudName}/image/upload/c_fill,w_160,h_160/${publicId}`;
}
