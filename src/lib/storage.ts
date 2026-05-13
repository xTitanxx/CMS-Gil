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

export function r2UrlForKey(key: string): string {
  return r2Url(key);
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

export async function getSignedDownloadUrl(url: string): Promise<string> {
  return url;
}

export function getMediaUrl(media: { storageKey: string }): Promise<string> {
  return getSignedDownloadUrl(media.storageKey);
}

// Strip filename bytes that survive URLSearchParams/JSON encoding but trip up
// downstream URL fetchers (Meta Graph rejects file_urls with literal spaces).
// Keep ASCII alphanumerics, dot, dash and underscore; collapse anything else
// to a single dash. Mirrors what S3/R2 callers commonly do for object keys.
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

export function audioKey(userId: string, filename: string): string {
  return `audio/${userId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export async function getThumbnailUrl(
  url: string,
  mimeType?: string
): Promise<string> {
  if (mimeType?.startsWith("video")) {
    return url.replace(/\.[^/.]+$/, ".poster.jpg");
  }
  return url;
}

export async function getObject(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function deleteObject(url: string): Promise<void> {
  try {
    const key = new URL(url).pathname.replace(/^\/+/, "");
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (err) {
    console.warn("deleteObject failed (swallowed):", err);
  }
}

export function mediaKey(userId: string, filename: string): string {
  return `media/${userId}/${Date.now()}-${sanitizeFilename(filename)}`;
}

export function importKey(userId: string, filename: string): string {
  return `import/${userId}/${Date.now()}-${sanitizeFilename(filename)}`;
}
