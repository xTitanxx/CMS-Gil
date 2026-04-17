import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { probeHasAudio } from "./video-processing";

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME ?? "cms-gil-media";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

function r2Url(key: string): string {
  if (!R2_PUBLIC_URL) throw new Error("R2_PUBLIC_URL env var is required");
  return `${R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`;
}

function legacyCloudinaryUrl(storageKey: string, mimeType?: string): string {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloud) return storageKey;
  const publicId = storageKey.replace(/\.[^/.]+$/, "");
  const isVideoLike = mimeType?.startsWith("video/") || mimeType?.startsWith("audio/");
  const resourceType = isVideoLike ? "video" : "image";
  return `https://res.cloudinary.com/${cloud}/${resourceType}/upload/${publicId}`;
}

function isLegacyPath(key: string): boolean {
  return !key.startsWith("http");
}

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
  if (typeof resource.audio_codec === "string" && resource.audio_codec.length > 0) {
    return true;
  }
  return false;
}

export interface UploadResult {
  url: string;
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

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: pathname,
      Body: body,
      ContentType: opts?.contentType,
    })
  );

  let hasAudio: boolean | null = null;
  if (isVideo) {
    try {
      hasAudio = await probeHasAudio(body);
    } catch (err) {
      console.warn("Audio probe failed, defaulting to null:", err);
    }
  }

  return { url: r2Url(pathname), hasAudio };
}

export async function fetchVideoAudioStatus(url: string): Promise<boolean | null> {
  try {
    const buffer = await getObject(url);
    return await probeHasAudio(buffer);
  } catch (err) {
    console.warn("fetchVideoAudioStatus failed:", err);
    return null;
  }
}

export async function getSignedDownloadUrl(
  urlOrPath: string,
  _expiresIn = 3600,
  mimeType?: string,
  _audioOverlayKey?: string | null
): Promise<string> {
  if (urlOrPath.startsWith("http")) {
    return urlOrPath;
  }
  return legacyCloudinaryUrl(urlOrPath, mimeType);
}

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

export async function getThumbnailUrl(
  url: string,
  mimeType?: string
): Promise<string> {
  if (isLegacyPath(url)) {
    return legacyCloudinaryUrl(url, mimeType);
  }
  if (mimeType?.startsWith("video")) {
    return url.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return url;
}

export async function getObject(url: string, mimeType?: string): Promise<Buffer> {
  const resolved = isLegacyPath(url) ? legacyCloudinaryUrl(url, mimeType) : url;
  const response = await fetch(resolved);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${resolved}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(url: string, _mimeType?: string): Promise<void> {
  if (isLegacyPath(url)) return;
  try {
    const key = new URL(url).pathname.replace(/^\/+/, "");
    await s3.send(
      new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })
    );
  } catch (err) {
    console.warn("deleteObject failed (swallowed):", err);
  }
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${filename}`;
}
