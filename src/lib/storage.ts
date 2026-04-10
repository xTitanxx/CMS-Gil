import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Determines whether a Cloudinary video resource has an audio track.
 *
 * Cloudinary's upload and admin resource responses include an `audio` object
 * for videos ({ codec, frequency, channels, bit_rate, ... }) when an audio
 * track is present. When the video is silent, the `audio` field is either
 * missing or an empty object. This helper normalizes that into a tri-state:
 *   - true:  audio track is present
 *   - false: resource is a video with no audio track
 *   - null:  resource is not a video, or we can't tell
 */
export function hasAudioFromResource(
  resource: { resource_type?: string; audio?: unknown } | null | undefined
): boolean | null {
  if (!resource) return null;
  if (resource.resource_type !== "video") return null;
  const audio = resource.audio;
  if (audio && typeof audio === "object" && Object.keys(audio).length > 0) {
    return true;
  }
  return false;
}

export interface UploadResult {
  /** Whether the uploaded resource has an audio track (null for non-videos) */
  hasAudio: boolean | null;
}

export async function uploadBuffer(
  key: string,
  body: Buffer
): Promise<UploadResult> {
  // Strip extension from public_id — Cloudinary appends the detected format automatically.
  // Without this, the stored public_id would include the extension (e.g. "file.jpg"),
  // causing URLs to resolve to "file.jpg.jpg" (double extension) → 404.
  const publicId = key.replace(/\.[^/.]+$/, "");
  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: "auto", type: "upload" },
      (error, uploadResult) => {
        if (error) return reject(error);
        if (!uploadResult) return reject(new Error("Cloudinary returned no result"));
        resolve(uploadResult);
      }
    );
    stream.end(body);
  });

  return { hasAudio: hasAudioFromResource(result) };
}

/**
 * Fetches a video's audio-track status from Cloudinary's admin API.
 * Used by scripts/backfill-audio.ts to retroactively check videos that were
 * uploaded before hasAudio was captured at upload time.
 *
 * Note: the admin API has tighter rate limits than the delivery API — the
 * caller should concurrency-limit this to ~5 parallel calls.
 */
export async function fetchVideoAudioStatus(key: string): Promise<boolean | null> {
  const publicId = key.replace(/\.[^/.]+$/, "");
  const resource = await cloudinary.api.resource(publicId, {
    resource_type: "video",
    type: "upload",
    media_metadata: true,
  });
  return hasAudioFromResource(resource);
}

export async function getSignedDownloadUrl(
  key: string,
  _expiresIn = 3600,
  mimeType?: string
): Promise<string> {
  const isVideo = mimeType?.startsWith("video");
  const resourceType = isVideo ? "video" : "image";
  // Strip extension — Cloudinary appends the format automatically; including it in
  // the public_id would produce a double-extension URL (e.g. file.jpg.jpg).
  const publicId = key.replace(/\.[^/.]+$/, "");
  return cloudinary.url(publicId, { resource_type: resourceType, type: "upload" });
}

// Returns a jpg poster frame for videos, or the image URL for images
export async function getThumbnailUrl(
  key: string,
  mimeType?: string
): Promise<string> {
  const isVideo = mimeType?.startsWith("video");
  const publicId = key.replace(/\.[^/.]+$/, "");
  if (isVideo) {
    // Cloudinary auto-generates a jpg thumbnail for videos
    return cloudinary.url(publicId, {
      resource_type: "video",
      type: "upload",
      format: "jpg",
    });
  }
  return cloudinary.url(publicId, { resource_type: "image", type: "upload" });
}

export async function getObject(key: string): Promise<Buffer> {
  const url = cloudinary.url(key, { resource_type: "auto", type: "upload" });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${key}: ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(key: string, mimeType?: string): Promise<void> {
  const publicId = key.replace(/\.[^/.]+$/, "");
  const resourceType = mimeType?.startsWith("video") ? "video" : "image";
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "upload" });
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${filename}`;
}
