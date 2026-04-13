// Parses Facebook's JSON export formats:
// 1. Posts format: your_posts_N.json — top-level array of {timestamp, data, attachments}
// 2. Album format: e.g. mobile_uploads.json — {name, photos: [{uri, creation_timestamp, description}]}
// 3. Videos format: your_videos.json — {videos_v2: [...]}
// 4. Label-values format: reels_you_have_pinned.json — top-level array of {timestamp, label_values: [{label, media}]}

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

export interface FBLabelValue {
  label: string;
  value?: string;
  timestamp_value?: number;
  media?: FBMediaAttachment[];
}

export interface FBPost {
  timestamp: number;
  data?: Array<{ post?: string }>;
  title?: string;
  attachments?: FBAttachment[];
  tags?: Array<{ name: string }>;
  label_values?: FBLabelValue[];
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
  // Priority for cross-file dedup. Higher wins when the same sourceId appears
  // in multiple exported files. your_posts_*.json (post.timestamp) is preferred
  // over album/0.json and your_videos.json (creation_timestamp), because the
  // latter reflects media upload time — often the last edit — not the original
  // post time. See dedupeParsedPosts().
  priority?: number;
}

// Priority constants for cross-file dedup.
// your_posts_*.json uses post.timestamp, which is FB's internal post-entity time
// and is closest to the actual post time for un-edited posts.
// album/0.json and your_videos.json use media creation_timestamp, which is the
// most recent upload of the media (gets rewritten on every edit).
const PRIORITY_POSTS_FILE = 2;
const PRIORITY_MEDIA_FILE = 1;

// Auto-detects format and parses accordingly
export function parseFacebookFile(raw: unknown): ParsedPost[] {
  if (Array.isArray(raw)) {
    return parseFacebookExport(raw);
  }
  if (raw && typeof raw === "object") {
    if ("photos" in raw) return parseAlbumExport(raw as FBAlbum);
    if ("videos_v2" in raw) return parseVideosExport(raw as { videos_v2: FBVideoEntry[] });
    if ("archived_stories_v2" in raw) return parseStoriesExport(raw as { archived_stories_v2: FBPost[] });
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

    // Body must come from data[n].post — never fall back to post.title.
    // Titles are always meta-activity strings ("X shared a post.", "X added a video.", etc.)
    // and are not original content.
    let body = "";
    if (Array.isArray(post.data)) {
      for (const d of post.data) {
        if (d.post) {
          body = fixFBEncoding(d.post);
          break;
        }
      }
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

    // Handle label_values format (reels_you_have_pinned.json, etc.)
    // Skip items with a "Shared" label — those are Facebook-generated memory events, not user posts.
    if (mediaUris.length === 0 && Array.isArray(post.label_values)) {
      const isMemoryEvent = post.label_values.some(lv => lv.label === "Shared");
      if (!isMemoryEvent) {
        for (const lv of post.label_values) {
          if (!Array.isArray(lv.media)) continue;
          for (const m of lv.media) {
            if (m.uri) mediaUris.push(m.uri);
            if (!body && m.description) body = fixFBEncoding(m.description);
          }
        }
      }
    }

    if (!body && mediaUris.length === 0) continue;

    // Use the first media filename as sourceId so this post naturally deduplicates
    // against the same photo/video appearing in an album JSON from the same export.
    const firstMedia = mediaUris[0];
    const sourceId = firstMedia
      ? `fb_media_${mediaFilename(firstMedia)}`
      : `fb_${post.timestamp}`;

    results.push({
      body,
      originalDate: new Date(post.timestamp * 1000),
      sourceId,
      mediaUris,
      priority: PRIORITY_POSTS_FILE,
    });
  }

  return results;
}

function mediaFilename(uri: string): string {
  return uri.split("/").pop()?.replace(/\.[^/.]+$/, "") ?? uri;
}

// Format 2: album JSON — {name, photos: [...]}
export function parseAlbumExport(album: FBAlbum): ParsedPost[] {
  if (!Array.isArray(album.photos)) return [];

  const results: ParsedPost[] = [];

  for (const photo of album.photos) {
    if (!photo.uri || !photo.creation_timestamp) continue;

    const body = photo.description ? fixFBEncoding(photo.description) : "";
    // Use media filename as sourceId — matches the ID generated by parseFacebookExport
    // for the same photo, so duplicates across file types are caught by dedup.
    const sourceId = `fb_media_${mediaFilename(photo.uri)}`;

    results.push({
      body,
      originalDate: new Date(photo.creation_timestamp * 1000),
      sourceId,
      mediaUris: [photo.uri],
      priority: PRIORITY_MEDIA_FILE,
    });
  }

  return results;
}

export interface FBVideoEntry {
  uri: string;
  creation_timestamp: number;
  title?: string;
  description?: string;
}

// Format 3: your_videos.json — {videos_v2: [...]}
// Facebook re-encodes the same video for different destinations (feed, mobile,
// reel, story, preview thumbnail). All variants share the same
// creation_timestamp and description but have distinct filenames and file sizes.
// We collapse them by (timestamp, description) — keeping only the first entry
// per group — so re-encodings don't produce duplicate posts.
export function parseVideosExport(raw: { videos_v2: FBVideoEntry[] }): ParsedPost[] {
  if (!Array.isArray(raw.videos_v2)) return [];

  const results: ParsedPost[] = [];
  const seen = new Set<string>();

  for (const video of raw.videos_v2) {
    if (!video.uri || !video.creation_timestamp) continue;

    const body = video.description ? fixFBEncoding(video.description) : (video.title ? fixFBEncoding(video.title) : "");

    // Dedupe key: same timestamp + same description = same video, different encoding
    const dedupeKey = `${video.creation_timestamp}|${body}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const sourceId = `fb_media_${mediaFilename(video.uri)}`;

    results.push({
      body,
      originalDate: new Date(video.creation_timestamp * 1000),
      sourceId,
      mediaUris: [video.uri],
      priority: PRIORITY_MEDIA_FILE,
    });
  }

  return results;
}

// Format 4: archived_stories.json — {archived_stories_v2: [...]}
// Same shape as your_posts (timestamp, attachments with media, data, title) but
// wrapped in a named key instead of being a top-level array.
export function parseStoriesExport(raw: { archived_stories_v2: FBPost[] }): ParsedPost[] {
  if (!Array.isArray(raw.archived_stories_v2)) return [];
  // Stories use the same internal structure as posts — delegate to the posts parser
  // but tag sourceIds with "fb_story_" prefix to avoid collisions with regular posts.
  const parsed = parseFacebookExport(raw.archived_stories_v2);
  return parsed.map((p) => ({
    ...p,
    sourceId: p.sourceId.replace(/^fb_/, "fb_story_"),
    priority: PRIORITY_MEDIA_FILE,
  }));
}

// Dedupes posts parsed from multiple export files. Runs two passes:
//
// 1. Collapse by sourceId, keeping the entry with the highest `priority`.
//    This matters when the same photo appears in both your_posts_*.json
//    (as an attachment) and album/0.json (as a standalone photo): the album
//    entry uses the media's creation_timestamp — which Facebook rewrites
//    every time the post is edited — whereas the posts-file entry uses the
//    post's own timestamp, which is closer to the actual post time.
//
// 2. Collapse duplicates by body, keeping the earliest timestamp. Facebook
//    serializes the same post multiple times when:
//      - the post was edited (pre-edit + post-edit entries with different
//        timestamps in your_posts_*.json)
//      - the same video was re-encoded for different destinations (reel
//        vs feed vs mobile), producing multiple near-identical media files
//        with distinct filenames and distinct creation_timestamps in
//        your_videos.json — all carrying the same description
//    Both collapse via this pass. The earliest timestamp wins (original over
//    edits/re-encodings). Only non-empty bodies are considered: empty-body
//    photo posts on the same day are legitimately separate and must not be
//    merged. Media URIs from the dropped entries are unioned into the keeper
//    so nothing is lost from Cloudinary upload.
export function dedupeParsedPosts(posts: ParsedPost[]): ParsedPost[] {
  // Pass 0 — suppress your_videos.json entries whose media also appears in
  // archived_stories or your_posts. your_videos.json is a flat dump of ALL
  // uploaded videos (stories, reels, posts) so it creates duplicates unless
  // we drop entries that are already covered by a more specific source.
  // A story entry (fb_story_media_X) or posts entry (fb_media_X with priority
  // POSTS_FILE) takes precedence over a bare video entry (fb_media_X with
  // priority MEDIA_FILE).
  const storyMediaIds = new Set<string>();
  const postsFileMediaIds = new Set<string>();
  for (const post of posts) {
    if (post.sourceId.startsWith("fb_story_media_")) {
      storyMediaIds.add(post.sourceId.replace("fb_story_media_", ""));
    } else if (
      post.sourceId.startsWith("fb_media_") &&
      (post.priority ?? 0) >= PRIORITY_POSTS_FILE
    ) {
      postsFileMediaIds.add(post.sourceId.replace("fb_media_", ""));
    }
  }
  const filtered = posts.filter((post) => {
    // Only suppress fb_media_ entries from your_videos.json (MEDIA_FILE priority)
    // when the same media filename is claimed by a story or a posts-file entry.
    if (
      post.sourceId.startsWith("fb_media_") &&
      (post.priority ?? 0) < PRIORITY_POSTS_FILE
    ) {
      const mediaId = post.sourceId.replace("fb_media_", "");
      if (storyMediaIds.has(mediaId) || postsFileMediaIds.has(mediaId)) {
        return false;
      }
    }
    return true;
  });

  // Pass 1 — collapse by sourceId (priority wins).
  const bySourceId = new Map<string, ParsedPost>();
  for (const post of filtered) {
    const existing = bySourceId.get(post.sourceId);
    if (!existing) {
      bySourceId.set(post.sourceId, post);
      continue;
    }
    const existingPriority = existing.priority ?? 0;
    const incomingPriority = post.priority ?? 0;
    if (incomingPriority > existingPriority) {
      bySourceId.set(post.sourceId, post);
    }
  }

  // Pass 2 — collapse by body (earliest originalDate wins).
  const byBody = new Map<string, ParsedPost>();
  const output: ParsedPost[] = [];
  for (const post of bySourceId.values()) {
    if (post.body.trim() === "") {
      // empty-body posts (photo-only, no caption) are never merged by body
      output.push(post);
      continue;
    }
    const key = post.body;
    const existing = byBody.get(key);
    if (!existing) {
      byBody.set(key, post);
      continue;
    }
    // Pick the earlier-dated entry as the base — that's the original, not a
    // later edit/re-encoding.
    const [base, other] =
      post.originalDate.getTime() < existing.originalDate.getTime()
        ? [post, existing]
        : [existing, post];
    // Union media URIs so nothing that was in the dropped entry is lost.
    const seen = new Set(base.mediaUris);
    const merged = [...base.mediaUris];
    for (const uri of other.mediaUris) {
      if (!seen.has(uri)) {
        seen.add(uri);
        merged.push(uri);
      }
    }
    byBody.set(key, { ...base, mediaUris: merged });
  }
  output.push(...byBody.values());
  return output;
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
