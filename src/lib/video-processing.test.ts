import { describe, it, expect, beforeAll } from "vitest";
import ffmpegStatic from "ffmpeg-static";
import ffmpeg from "fluent-ffmpeg";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressVideo } from "./video-processing";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

// Synthesize a deterministic video buffer via ffmpeg's testsrc filter so the
// test doesn't depend on any fixture file. `duration` seconds at the given
// resolution; high bitrate so the result is comfortably above any 20 MB-ish
// target the compressor would trip on.
async function makeTestVideo(
  durationSec: number,
  width = 1920,
  height = 1080
): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "vid-test-"));
  const outputPath = join(dir, "test.mp4");

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(`testsrc=duration=${durationSec}:size=${width}x${height}:rate=30`)
        .inputOptions(["-f lavfi"])
        .outputOptions([
          "-c:v libx264",
          "-preset ultrafast",
          "-crf 18",
          "-pix_fmt yuv420p",
        ])
        .on("end", () => resolve())
        .on("error", reject)
        .save(outputPath);
    });

    return readFileSync(outputPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("compressVideo", () => {
  // Synthesizing + re-encoding is slow on a CI runner with cold ffmpeg cache.
  // 60s is enough for a 5-second source at 1080p plus a single H.264 pass.
  const TEST_TIMEOUT = 60_000;

  let bigVideo: Buffer;

  beforeAll(async () => {
    bigVideo = await makeTestVideo(5);
  }, TEST_TIMEOUT);

  it(
    "returns input unchanged when already under target",
    async () => {
      const small = Buffer.from("not a video, just bytes under the cap");
      const out = await compressVideo(small, { targetBytes: 1024 });
      expect(out).toBe(small);
    },
    TEST_TIMEOUT
  );

  it(
    "produces a non-empty MP4 buffer smaller than the source",
    async () => {
      // Use a very low target so the compressor definitely engages even on a
      // small synthetic input.
      const out = await compressVideo(bigVideo, { targetBytes: 100 * 1024 });
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(bigVideo.length);
      // MP4 magic: bytes 4-7 are "ftyp"
      expect(out.subarray(4, 8).toString("ascii")).toBe("ftyp");
    },
    TEST_TIMEOUT
  );
});
