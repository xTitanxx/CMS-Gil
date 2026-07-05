import ffmpegStatic from "ffmpeg-static";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffprobeStatic = require("ffprobe-static") as { path: string };
import ffmpeg from "fluent-ffmpeg";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);
if (ffprobeStatic.path) ffmpeg.setFfprobePath(ffprobeStatic.path);

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "vidproc-"));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function probeDuration(inputPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, data) => {
      if (err) return reject(err);
      const duration = data?.format?.duration;
      if (typeof duration !== "number" || !Number.isFinite(duration)) {
        return reject(new Error("Could not determine video duration"));
      }
      resolve(duration);
    });
  });
}

// Strategies tried in order. The first one that yields a non-empty JPEG wins.
// Some FB-export videos won't decode the very first frame (no I-frame at t=0)
// or have weird audio streams that confuse ffmpeg; later strategies seek
// further in and drop audio to recover.
const POSTER_STRATEGIES: ReadonlyArray<{ name: string; opts: string[] }> = [
  { name: "frame:v 1", opts: ["-frames:v 1", "-q:v 3"] },
  { name: "seek 0.5s -an", opts: ["-ss", "0.5", "-an", "-frames:v 1", "-q:v 3"] },
  { name: "seek 2s -an", opts: ["-ss", "2", "-an", "-frames:v 1", "-q:v 3"] },
  { name: "seek 5s -an q5", opts: ["-ss", "5", "-an", "-frames:v 1", "-q:v 5"] },
];

async function tryStrategy(
  videoBuffer: Buffer,
  opts: string[]
): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input.mp4");
    const outputPath = join(dir, "poster.jpg");
    writeFileSync(inputPath, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(opts)
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    const buf = readFileSync(outputPath);
    if (buf.length === 0) throw new Error("ffmpeg produced 0-byte poster");
    return buf;
  });
}

export async function extractPoster(videoBuffer: Buffer): Promise<Buffer> {
  let lastErr: unknown = null;
  for (const s of POSTER_STRATEGIES) {
    try {
      return await tryStrategy(videoBuffer, s.opts);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `extractPoster: all ${POSTER_STRATEGIES.length} strategies failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`
  );
}

export async function extractFrames(
  videoBuffer: Buffer,
  offsets: readonly number[]
): Promise<Buffer[]> {
  if (offsets.length === 0) return [];

  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input.mp4");
    writeFileSync(inputPath, videoBuffer);

    const duration = await probeDuration(inputPath);

    const frames: Buffer[] = [];
    for (let i = 0; i < offsets.length; i++) {
      const offset = offsets[i];
      const clamped = Math.max(0, Math.min(1, offset));
      // Keep seek time strictly inside the video. Seeking into the last fraction
      // of a second commonly lands past the final decodable frame (B-frame lookahead,
      // no keyframe reachable) and yields an empty output. Cap at 90% of duration —
      // offset=1.0 means "near the end", not literally the final byte.
      const maxSeek = duration * 0.9;
      const seek = Math.max(0, Math.min(maxSeek, clamped * duration));
      const outputPath = join(dir, `frame-${i}.jpg`);

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .seekInput(seek)
          .outputOptions(["-frames:v 1", "-q:v 3"])
          .on("end", () => resolve())
          .on("error", reject)
          .save(outputPath);
      });

      frames.push(readFileSync(outputPath));
    }

    return frames;
  });
}

export async function mixAudioOntoVideo(
  videoBuffer: Buffer,
  audioBuffer: Buffer
): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const videoPath = join(dir, "video.mp4");
    const audioPath = join(dir, "audio.bin");
    const outputPath = join(dir, "mixed.mp4");
    writeFileSync(videoPath, videoBuffer);
    writeFileSync(audioPath, audioBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 1:a:0",
          "-c:v copy",
          "-c:a aac",
          "-shortest",
        ])
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    return readFileSync(outputPath);
  });
}

// Remux (not re-encode — a fast, lossless container swap) an arbitrary
// input video into a genuine MP4 container. Used for videos that arrive as
// something other than MP4 (most commonly .mov straight off an iPhone).
// Relabeling a .mov's extension/MIME type client-side isn't enough on its
// own: some players and share targets (Facebook and WhatsApp's share-intent
// handling among them) sniff the actual container structure rather than
// trusting the declared type, and still treat a relabeled-but-still-
// QuickTime file as non-video. This guarantees real MP4 bytes underneath
// the label, not just a renamed file.
export async function remuxToMp4(videoBuffer: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input");
    const outputPath = join(dir, "remuxed.mp4");
    writeFileSync(inputPath, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-c:v copy", "-c:a copy", "-movflags +faststart"])
        .format("mp4")
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    const out = readFileSync(outputPath);
    if (out.length === 0) throw new Error("ffmpeg produced 0-byte remux output");
    return out;
  });
}

// Target audio bitrate for compressed output. 128 kbps AAC is the standard
// "voice + light music" tier and what every phone-shot clip in this repo
// realistically needs.
const COMPRESS_AUDIO_BITRATE = 128_000;

// Floor for video bitrate. Below ~200 kbps even 480p H.264 is a smear, so we
// accept overshooting the size budget for very-long videos rather than
// producing a file the user can't actually watch.
const COMPRESS_MIN_VIDEO_BITRATE = 200_000;

// Don't upscale. Phone-shot vertical video is already ≥1080px on the long edge,
// and 1280px on the long edge is plenty for a phone-width feed.
const COMPRESS_LONG_EDGE_MAX = 1280;

const DEFAULT_TARGET_BYTES = 20 * 1024 * 1024;

export interface CompressVideoOptions {
  targetBytes?: number;
}

// Re-encode an input video to roughly `targetBytes` (default 20 MB). Returns
// the original buffer unchanged if it's already at or under the target — or
// if the re-encode somehow ends up larger (can happen for already-tiny clips).
// Throws on ffmpeg failure; callers decide whether to fall back to original.
export async function compressVideo(
  videoBuffer: Buffer,
  opts: CompressVideoOptions = {}
): Promise<Buffer> {
  const targetBytes = opts.targetBytes ?? DEFAULT_TARGET_BYTES;
  if (videoBuffer.length <= targetBytes) return videoBuffer;

  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input.mp4");
    const outputPath = join(dir, "output.mp4");
    writeFileSync(inputPath, videoBuffer);

    const duration = await probeDuration(inputPath);

    // Reserve the audio budget out of the total before sizing video.
    const totalBits = targetBytes * 8;
    const audioBits = COMPRESS_AUDIO_BITRATE * duration;
    const videoBitrate = Math.max(
      COMPRESS_MIN_VIDEO_BITRATE,
      Math.floor((totalBits - audioBits) / duration)
    );

    // CRF caps quality; maxrate+bufsize cap the actual size growth so the
    // output stays near the bitrate target. Without maxrate/bufsize, CRF
    // alone can overshoot wildly on noisy/grainy source material.
    const maxrate = Math.floor(videoBitrate * 1.2);
    const bufsize = videoBitrate * 2;

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          "-c:v libx264",
          "-preset veryfast",
          "-crf 28",
          `-maxrate ${maxrate}`,
          `-bufsize ${bufsize}`,
          // Scale so the long edge is ≤ COMPRESS_LONG_EDGE_MAX, preserving aspect
          // ratio, only downscaling. yuv420p needs even dimensions, hence -2.
          `-vf scale='if(gt(iw,ih),min(${COMPRESS_LONG_EDGE_MAX},iw),-2)':'if(gt(iw,ih),-2,min(${COMPRESS_LONG_EDGE_MAX},ih))'`,
          "-pix_fmt yuv420p",
          "-movflags +faststart",
          "-c:a aac",
          `-b:a ${COMPRESS_AUDIO_BITRATE}`,
        ])
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    const out = readFileSync(outputPath);
    if (out.length === 0) throw new Error("ffmpeg produced 0-byte output");
    // Already-small or odd inputs can re-encode larger than they started.
    // Keep the smaller of the two.
    return out.length < videoBuffer.length ? out : videoBuffer;
  });
}

export async function probeHasAudio(videoBuffer: Buffer): Promise<boolean> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input.mp4");
    writeFileSync(inputPath, videoBuffer);

    return new Promise<boolean>((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, data) => {
        if (err) return reject(err);
        const streams = data?.streams ?? [];
        resolve(streams.some((s) => s.codec_type === "audio"));
      });
    });
  });
}
