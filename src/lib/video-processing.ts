import { path as ffprobePath } from "ffprobe-static";
import ffmpeg from "fluent-ffmpeg";

/**
 * Probes a video buffer for audio tracks using ffprobe.
 * Returns true if the video has an audio stream, false if silent.
 */
export async function probeHasAudio(buffer: Buffer): Promise<boolean> {
  const { Readable } = await import("stream");
  return new Promise<boolean>((resolve, reject) => {
    const readable = new Readable();
    readable.push(buffer);
    readable.push(null);

    ffmpeg(readable)
      .setFfprobePath(ffprobePath)
      .ffprobe((err, data) => {
        if (err) {
          // If probing fails, assume no audio rather than crashing
          console.warn("ffprobe failed, assuming no audio:", err.message);
          resolve(false);
          return;
        }
        const hasAudio = data.streams.some(
          (s) => s.codec_type === "audio"
        );
        resolve(hasAudio);
      });
  });
}
