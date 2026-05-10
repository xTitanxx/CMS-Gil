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
