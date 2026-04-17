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

export async function extractPoster(videoBuffer: Buffer): Promise<Buffer> {
  return withTempDir(async (dir) => {
    const inputPath = join(dir, "input.mp4");
    const outputPath = join(dir, "poster.jpg");
    writeFileSync(inputPath, videoBuffer);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions(["-frames:v 1", "-q:v 3"])
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    return readFileSync(outputPath);
  });
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
