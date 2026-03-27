// Parses Facebook's JSON export format
// Export structure: your_posts/your_posts_1.json

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

export interface ParsedPost {
  body: string;
  originalDate: Date;
  sourceId: string;
  mediaUris: string[];
}

export function parseFacebookExport(raw: unknown): ParsedPost[] {
  if (!Array.isArray(raw)) return [];

  const results: ParsedPost[] = [];

  for (const item of raw) {
    const post = item as FBPost;
    if (!post.timestamp) continue;

    // Extract text body
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

    // Extract media URIs from attachments
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

    // Skip posts with no content and no media
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
