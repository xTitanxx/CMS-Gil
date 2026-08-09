import type { NextConfig } from "next";

// Routes whose serverless function actually loads ffmpeg / ffprobe via the
// import chain (storage.ts → video-processing.ts → fluent-ffmpeg). Any new
// route that uploads media, publishes, imports, or analyzes posts needs to
// be added here, or its bundle will be missing the binaries at runtime.
//
// The previous wildcard `"/**/*"` shipped the ~80MB binary set into every
// serverless function bundle (~80 routes), pushing total upload to multiple
// gigabytes and stalling Vercel deploys in "Deploying outputs..." for
// 10+ minutes. Scoping to the actual users keeps the bundle small.
// ffprobe-static ships every platform's binary (~378MB total: darwin 132MB,
// linux 99MB, win32 104MB). Vercel Functions run on linux/x64, so include
// only that one — keeps each function bundle under Vercel's 250MB limit.
const FFMPEG_FILES = [
  "node_modules/ffmpeg-static/ffmpeg",
  "node_modules/ffprobe-static/bin/linux/x64/**",
];
const FFMPEG_ROUTES = [
  "/api/posts/[id]/media",
  "/api/posts/[id]/publish",
  "/api/posts/[id]/analyze",
  "/api/posts/bulk-analyze",
  "/api/audio",
  "/api/media/[id]/replace",
  "/api/import/upload",
  "/api/import/process",
  "/api/drive/sync",
  "/api/cron/publish",
  "/api/cron/drive-sync",
];

const nextConfig: NextConfig = {
  images: {
    // Next.js 16 only accepts quality 75 unless custom values are explicitly
    // allowlisted. The admin feed requests 55 for lighter mobile thumbnails.
    qualities: [55, 75],
    remotePatterns: [
      // Allow signed S3/R2 URLs
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "**.r2.dev" },
      { protocol: "https", hostname: "**.amazonaws.com" },
      { protocol: "https", hostname: "**.s3.amazonaws.com" },
    ],
  },
  // Keep ffmpeg/ffprobe out of the webpack bundle so __dirname resolves to the
  // real package directory at runtime instead of a "/ROOT/..." placeholder.
  serverExternalPackages: ["ffmpeg-static", "ffprobe-static", "fluent-ffmpeg"],
  // Force the binaries into only the function bundles that actually need them.
  outputFileTracingIncludes: Object.fromEntries(
    FFMPEG_ROUTES.map((route) => [route, FFMPEG_FILES]),
  ),
  // Allow large file uploads for Facebook exports
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
