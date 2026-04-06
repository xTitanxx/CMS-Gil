// Parses Facebook's JSON export formats:
// 1. Posts format: your_posts_N.json — top-level array of {timestamp, data, attachments}
// 2. Album format: e.g. mobile_uploads.json — {name, photos: [{uri, creation_timestamp, description}]}

export interface FBMediaAttachment {
  uri: string;
  description?: string;
  title?: string;
  creation_timestamp?: number;
}

export interface FBAttachment {
  data: Array<{
    media?: FBMediaAttachment;
    external_context?: { url?: string; source?: string; name?: string };
    text?: string;
  }>;
}

export interface FBPost {
  timestamp: number;
  data?: Array<{ post?: string }>;
  title?: string;
  attachments?: FBAttachment[];
  tags?: Array<{ name: string }>;
}

export interface FBAlbumPhoto {
  uri: string;
  creation_timestamp: number;
  title?: string;
  description?: string;
  media_metadata?: unknown;
}

export interface FBAlbum {
  name: string;
  photos: FBAlbumPhoto[];
}

export interface ParsedPost {
  body: string;
  originalDate: Date;
  sourceId: string;
  mediaUris: string[];
}

// Auto-detects format and parses accordingly
export function parseFacebookFile(raw: unknown): ParsedPost[] {
  if (Array.isArray(raw)) {
    return parseFacebookExport(raw);
  }
  if (raw && typeof raw === "object" && "photos" in raw) {
    return parseAlbumExport(raw as FBAlbum);
  }
  return [];
}

// Format 1: your_posts_N.json — array of posts
export function parseFacebookExport(raw: unknown): ParsedPost[] {
  if (!Array.isArray(raw)) return [];

  const results: ParsedPost[] = [];

  for (const item of raw) {
    const post = item as FBPost;
    if (!post.timestamp) continue;

    let body = "";
    if (Array.isArray(post.data)) {
      for (const d of post.data) {
        if (d.post) {
          body = fixFBEncoding(d.post);
          break;
        }
      }
    }
    if (!body && post.title) {
      body = fixFBEncoding(post.title);
    }

    const mediaUris: string[] = [];
    if (Array.isArray(post.attachments)) {
      for (const att of post.attachments) {
        if (!Array.isArray(att.data)) continue;
        for (const d of att.data) {
          if (d.media?.uri) {
            mediaUris.push(d.media.uri);
          }
        }
      }
    }

    if (!body && mediaUris.length === 0) continue;

    results.push({
      body,
      originalDate: new Date(post.timestamp * 1000),
      sourceId: `fb_${post.timestamp}`,
      mediaUris,
    });
  }

  return results;
}

// Format 2: album JSON — {name, photos: [...]}
export function parseAlbumExport(album: FBAlbum): ParsedPost[] {
  if (!Array.isArray(album.photos)) return [];

  const results: ParsedPost[] = [];

  for (const photo of album.photos) {
    if (!photo.uri || !photo.creation_timestamp) continue;

    const body = photo.description ? fixFBEncoding(photo.description) : "";
    // Use the URI as a stable unique ID (normalized)
    const sourceId = `fb_photo_${photo.uri.replace(/[^a-zA-Z0-9]/g, "_")}`;

    results.push({
      body,
      originalDate: new Date(photo.creation_timestamp * 1000),
      sourceId,
      mediaUris: [photo.uri],
    });
  }

  return results;
}

// Facebook exports use latin1-encoded UTF-8 strings in some versions
function fixFBEncoding(str: string): string {
  try {
    return decodeURIComponent(escape(str));
  } catch {
    return str;
  }
}

export function guessMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    mp4: "video/mp4",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    webm: "video/webm",
    heic: "image/heic",
  };
  return map[ext] ?? "application/octet-stream";
}
