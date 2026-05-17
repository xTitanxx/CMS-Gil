# Video compression on upload

## Problem

A recent video upload landed in R2 at 300 MB. The CMS shows this video in a
public web feed and on phone-width screens, so 300 MB is two orders of magnitude
larger than necessary. Every oversized video also slows down poster extraction,
publishing (the publish pipeline re-reads the buffer to push to FB/IG), and
backfills that fetch the object.

Target: no video stored in R2 should exceed ~20 MB.

## Mechanism

New helper in `src/lib/video-processing.ts`:

```ts
compressVideo(buffer: Buffer, opts?: { targetBytes?: number }): Promise<Buffer>
```

Behavior:

1. If `buffer.length <= targetBytes` (default 20 MB) — return input unchanged.
2. ffprobe the duration. Compute target video bitrate:
   `videoBitrate = (targetBytes * 8 / duration) - 128_000` (128 kbps reserved for audio).
   Clamp to a floor of 200 kbps — below that, video is unwatchable; we accept
   going over budget rather than producing garbage.
3. Single-pass H.264 + AAC encode in an MP4 container. Scale the long edge to
   1280 px (preserving aspect ratio) and only downscale, never upscale.
   `-crf 28` with `-maxrate`/`-bufsize` matching the target bitrate so the
   final size stays close to budget without a true two-pass.
4. If the produced buffer is larger than the input (rare on already-tiny inputs),
   return the input.
5. On any ffmpeg error, throw — callers decide whether to fall back to the
   original.

The same `ffmpeg-static` / `fluent-ffmpeg` stack used by `extractPoster` —
no new dependencies.

## Wiring

Three entry points where new video buffers enter R2:

| Entry point | Pattern |
|---|---|
| `POST /api/posts/[id]/media` | Inside the existing `after()` block. Compress, re-upload over the same key with `uploadBuffer`, then update `Media.sizeBytes`. Poster extraction now runs against the compressed buffer. |
| `POST /api/media/[id]/replace` | Same pattern, but via a fresh `after()`. Need to add `import { after } from "next/server"` and set `export const maxDuration = 300`. |
| `src/lib/import-worker.ts` | Inline. The import worker already runs inside a long-lived `after()` from the upload route, so inline is fine. Compress before `uploadBuffer`, write the smaller buffer + smaller `sizeBytes`. |

`src/lib/publish-prep.ts` (mux pipeline) is **not** wired — publish-time mixed
videos are short-lived intermediates fed straight to FB/IG; if those are too
big the platforms reject them, but we don't store them long-term.

## Failure mode

Compression failures are logged and swallowed. The original video stays in R2
unchanged. Same posture as `extractPoster`.

## Backfill

`scripts/backfill-compress-videos.ts`:

- Walk `Media` where `mimeType` starts with `video/` and `sizeBytes > 20 MB`.
- Download from R2 → `compressVideo()` → re-upload over the same key →
  update `Media.sizeBytes` to new buffer size.
- Idempotent: re-running it on already-compressed media is a no-op (input is
  already under 20 MB, `compressVideo` returns the input unchanged, but we
  still skip up-front via the `sizeBytes > 20 MB` filter).
- Concurrency 3 (matches `backfill-video-posters.ts` — R2 throttles HEADs
  higher than that).
- Followed by `runReadiness` per affected post? No — sizeBytes change doesn't
  affect readiness signals.

Run order: ship the wiring first so new uploads stop adding to the problem,
then run the backfill against existing data.

## Tests

- Unit test on `compressVideo`: takes a small generated video (synthesized
  inline via ffmpeg `lavfi testsrc` so we don't need fixture files), confirms
  output is a non-empty buffer and is an MP4 (magic bytes start with `ftyp`).
- Skip the "actually under 20MB" assertion in the test — depends on machine
  ffmpeg performance and could flake. The size assertion happens in production
  via the backfill script.

## Non-goals

- No client-side compression (ffmpeg.wasm is ~30 MB and slow on phones).
- No two-pass encoding. CRF + maxrate/bufsize gets close enough for our
  quality tier (personal feed, never used as masters).
- No HLS / adaptive bitrate. We serve a single MP4 to a web `<video>` tag.
- No keeping the original alongside the compressed copy. 300 MB → 20 MB is
  the whole point; storing both defeats it.
