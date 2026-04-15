import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Determines whether a Cloudinary video resource has an audio track.
 *
 * Shape of Cloudinary's actual response (verified against live admin API):
 *   - Audible video: { resource_type: "video", has_audio: true, audio_codec: "aac", ... }
 *   - Silent video:  { resource_type: "video" }  — has_audio and all audio_* fields omitted
 *
 * Silent videos don't get `has_audio: false`; the fields are simply absent.
 * This helper treats an absent `has_audio` on a known video as "silent," with
 * `audio_codec` as a secondary signal for robustness across API versions.
 *
 * Returns:
 *   - true:  video has an audio track
 *   - false: video is silent (no audio track)
 *   - null:  not a video (field doesn't apply)
 */
export function hasAudioFromResource(
  resource:
    | { resource_type?: string; has_audio?: boolean; audio_codec?: string }
    | null
    | undefined
): boolean | null {
  if (!resource) return null;
  if (resource.resource_type !== "video") return null;
  if (resource.has_audio === true) return true;
  if (resource.has_audio === false) return false;
  // has_audio omitted — fall back to audio_codec presence
  if (typeof resource.audio_codec === "string" && resource.audio_codec.length > 0) {
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
      { public_id: publicId, resource_type: "auto", type: "upload", media_metadata: true },
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
  mimeType?: string,
  audioOverlayKey?: string | null
): Promise<string> {
  const isVideo = mimeType?.startsWith("video");
  const isAudio = mimeType?.startsWith("audio");
  const resourceType = isVideo || isAudio ? "video" : "image";
  // Strip extension — Cloudinary appends the format automatically; including it in
  // the public_id would produce a double-extension URL (e.g. file.jpg.jpg).
  const publicId = key.replace(/\.[^/.]+$/, "");

  if (isVideo && audioOverlayKey) {
    // Overlay a user-provided audio track onto the video. Cloudinary requires
    // slashes in the overlay public_id to be escaped as colons.
    const audioPublicId = audioOverlayKey.replace(/\.[^/.]+$/, "").replace(/\//g, ":");
    return cloudinary.url(publicId, {
      resource_type: "video",
      type: "upload",
      transformation: [
        { overlay: `video:${audioPublicId}` },
        { flags: "layer_apply" },
      ],
    });
  }

  return cloudinary.url(publicId, { resource_type: resourceType, type: "upload" });
}

/**
 * Convenience wrapper for media rows that may carry an AudioTrack overlay.
 * Pass the media object with its (optional) audioTrack relation.
 */
export function getMediaUrl(media: {
  storageKey: string;
  mimeType: string;
  audioTrack?: { storageKey: string } | null;
}): Promise<string> {
  return getSignedDownloadUrl(
    media.storageKey,
    3600,
    media.mimeType,
    media.audioTrack?.storageKey ?? null
  );
}

export function audioKey(userId: string, filename: string): string {
  return `audio/${userId}/${Date.now()}-${filename}`;
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
  const isVideoLike = mimeType?.startsWith("video") || mimeType?.startsWith("audio");
  const resourceType = isVideoLike ? "video" : "image";
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type: "upload" });
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${filename}`;
}
