import { put, del } from "@vercel/blob";
import { probeHasAudio } from "./video-processing";

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
  /** The full Blob URL of the uploaded file */
  url: string;
  /** Whether the uploaded resource has an audio track (null for non-videos) */
  hasAudio: boolean | null;
}

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".avi", ".webm", ".mkv", ".m4v", ".3gp", ".wmv",
]);

function isVideoContent(pathname: string, contentType?: string): boolean {
  if (contentType?.startsWith("video")) return true;
  const ext = pathname.match(/\.[^/.]+$/)?.[0]?.toLowerCase();
  return ext ? VIDEO_EXTENSIONS.has(ext) : false;
}

export async function uploadBuffer(
  pathname: string,
  body: Buffer,
  opts?: { contentType?: string }
): Promise<UploadResult> {
  const isVideo = isVideoContent(pathname, opts?.contentType);

  const blob = await put(pathname, body, {
    access: "public",
    addRandomSuffix: false,
    contentType: opts?.contentType,
    allowOverwrite: true,
  });

  let hasAudio: boolean | null = null;
  if (isVideo) {
    try {
      hasAudio = await probeHasAudio(body);
    } catch (err) {
      console.warn("Audio probe failed, defaulting to null:", err);
      hasAudio = null;
    }
  }

  return { url: blob.url, hasAudio };
}

/**
 * Fetches a video's audio-track status by downloading and probing it.
 * Used by scripts/backfill-audio.ts to retroactively check videos that were
 * uploaded before hasAudio was captured at upload time.
 */
export async function fetchVideoAudioStatus(url: string): Promise<boolean | null> {
  try {
    const buffer = await getObject(url);
    return await probeHasAudio(buffer);
  } catch (err) {
    console.warn("fetchVideoAudioStatus failed:", err);
    return null;
  }
}

/**
 * Returns a download URL for the given media.
 *
 * For full Blob URLs (new uploads / post-backfill), returns as-is since
 * Blob URLs are publicly accessible.
 *
 * For legacy Cloudinary pathnames (pre-backfill), logs a warning and returns
 * the path unchanged — the backfill script will replace these with Blob URLs.
 */
export async function getSignedDownloadUrl(
  urlOrPath: string,
  _expiresIn = 3600,
  _mimeType?: string,
  _audioOverlayKey?: string | null
): Promise<string> {
  if (urlOrPath.startsWith("http")) {
    return urlOrPath;
  }
  // Legacy Cloudinary pathname — can't resolve without the Cloudinary SDK
  console.warn(
    `getSignedDownloadUrl: legacy Cloudinary path "${urlOrPath}" — run backfill to migrate`
  );
  return urlOrPath;
}

/**
 * Convenience wrapper for media rows that may carry an AudioTrack overlay.
 * Pass the media object with its (optional) audioTrack relation.
 *
 * Note: audioTrack overlay is no longer supported after Cloudinary removal.
 * The audioTrack parameter is accepted but ignored.
 */
export function getMediaUrl(media: {
  storageKey: string;
  mimeType: string;
  audioTrack?: { storageKey: string } | null;
}): Promise<string> {
  return getSignedDownloadUrl(media.storageKey, 3600, media.mimeType);
}

export function audioKey(userId: string, filename: string): string {
  return `audio/${userId}/${Date.now()}-${filename}`;
}

/**
 * Returns a thumbnail URL for the given media.
 *
 * For videos: derives a poster URL by replacing the file extension with `.poster.jpg`.
 * For images: returns the URL unchanged.
 *
 * For legacy Cloudinary pathnames, returns unchanged with a warning.
 */
export async function getThumbnailUrl(
  url: string,
  mimeType?: string
): Promise<string> {
  if (!url.startsWith("http")) {
    console.warn(
      `getThumbnailUrl: legacy Cloudinary path "${url}" — run backfill to migrate`
    );
    return url;
  }

  const isVideo = mimeType?.startsWith("video");
  if (isVideo) {
    // Replace extension with .poster.jpg for video thumbnails
    return url.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return url;
}

/**
 * Fetches the content of a stored object as a Buffer.
 *
 * Only works with full Blob URLs. Legacy Cloudinary pathnames will throw.
 */
export async function getObject(url: string): Promise<Buffer> {
  if (!url.startsWith("http")) {
    throw new Error(
      `getObject: cannot fetch legacy Cloudinary path "${url}" — run backfill to migrate`
    );
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Deletes an object from Vercel Blob storage.
 * Errors are swallowed — deletion is best-effort.
 */
export async function deleteObject(url: string, _mimeType?: string): Promise<void> {
  if (!url.startsWith("http")) {
    console.warn(
      `deleteObject: cannot delete legacy Cloudinary path "${url}" — skipping`
    );
    return;
  }
  try {
    await del(url);
  } catch (err) {
    console.warn("deleteObject failed (swallowed):", err);
  }
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${filename}`;
}
