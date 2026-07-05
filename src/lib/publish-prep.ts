/**
 * Prepare a post's media URLs for upload to a social platform.
 *
 * Most media pass through unchanged. The one transformation: if a video has
 * `hasAudio === false` AND has an attached `AudioTrack`, mux the audio onto
 * the video first and upload the muxed result to a temporary R2 key. The
 * returned URL points at the muxed file, so platform modules don't need to
 * know about audio attachment at all — they just receive the right URL.
 *
 * Without this, attaching music in the web app would only affect the in-app
 * preview; the post would still ship muted to Instagram/FB/TikTok/YouTube/LI.
 */
import { getObject, uploadBuffer, mediaKey } from "@/lib/storage";
import { mixAudioOntoVideo } from "@/lib/video-processing";

export interface MediaForPublish {
  storageKey: string;
  mimeType: string;
  hasAudio: boolean | null;
  audioTrack?: { storageKey: string } | null;
}

export async function preparePublishKeys(
  userId: string,
  media: MediaForPublish[],
): Promise<string[]> {
  const out: string[] = [];
  for (const m of media) {
    const isVideo = m.mimeType.startsWith("video/");
    const needsMux = isVideo && m.hasAudio === false && m.audioTrack?.storageKey;
    if (!needsMux) {
      out.push(m.storageKey);
      continue;
    }
    const [videoBuffer, audioBuffer] = await Promise.all([
      getObject(m.storageKey),
      getObject(m.audioTrack!.storageKey),
    ]);
    const muxed = await mixAudioOntoVideo(videoBuffer, audioBuffer);
    // mixAudioOntoVideo always outputs an mp4 container regardless of the
    // input's format — tag the upload accordingly instead of inheriting the
    // original (possibly non-mp4, e.g. video/quicktime) mimeType.
    const key = mediaKey(userId, `muxed-${Date.now()}.mp4`);
    const { url } = await uploadBuffer(key, muxed, { contentType: "video/mp4" });
    out.push(url);
  }
  return out;
}
