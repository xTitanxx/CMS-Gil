/**
 * Tri-state audio classification for the videos in a post.
 *
 * - "has-audio"   → no badge needed (every video has its own audio).
 * - "silent"      → at least one video is silent AND has no music attached.
 * - "music-added" → every silent video has an AudioTrack attached. The publish
 *                   pipeline mux-es that audio onto the video before upload.
 *
 * Posts with no video media at all return "has-audio" (no badge).
 */
export type PostAudioState = "has-audio" | "silent" | "music-added";

interface MediaInput {
  mimeType?: string | null;
  hasAudio?: boolean | null;
  // Either form is accepted: a foreign-key field (`audioTrackId`) or the
  // included relation (`audioTrack`). Different selects across the codebase
  // surface one or the other.
  audioTrackId?: string | null;
  audioTrack?: { storageKey?: string } | null;
}

function hasMusicAttached(m: MediaInput): boolean {
  return !!m.audioTrackId || !!m.audioTrack?.storageKey;
}

export function postAudioState(media: MediaInput[]): PostAudioState {
  const videos = media.filter((m) => m.mimeType?.startsWith("video/"));
  if (videos.length === 0) return "has-audio";
  const silent = videos.filter((m) => m.hasAudio === false);
  if (silent.length === 0) return "has-audio";
  const allHaveMusic = silent.every(hasMusicAttached);
  return allHaveMusic ? "music-added" : "silent";
}
