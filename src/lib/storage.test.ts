import { describe, it, expect, vi } from "vitest";
import { hasAudioFromResource, mediaKey, getThumbnailUrl, getSignedDownloadUrl } from "./storage";

describe("hasAudioFromResource", () => {
  it("returns null for null/undefined input", () => {
    expect(hasAudioFromResource(null)).toBe(null);
    expect(hasAudioFromResource(undefined)).toBe(null);
  });

  it("returns null for non-video resources (field doesn't apply)", () => {
    expect(hasAudioFromResource({ resource_type: "image" })).toBe(null);
    expect(hasAudioFromResource({ resource_type: "raw" })).toBe(null);
    expect(hasAudioFromResource({ resource_type: "image", has_audio: true })).toBe(null);
  });

  it("returns true when video has has_audio=true", () => {
    expect(
      hasAudioFromResource({
        resource_type: "video",
        has_audio: true,
        audio_codec: "aac",
      })
    ).toBe(true);
  });

  it("returns false when video has explicit has_audio=false", () => {
    expect(
      hasAudioFromResource({ resource_type: "video", has_audio: false })
    ).toBe(false);
  });

  it("treats absent has_audio on a video as silent (real Cloudinary shape)", () => {
    expect(hasAudioFromResource({ resource_type: "video" })).toBe(false);
  });

  it("falls back to audio_codec presence when has_audio is absent", () => {
    expect(
      hasAudioFromResource({ resource_type: "video", audio_codec: "aac" })
    ).toBe(true);
  });

  it("returns false when audio_codec is an empty string", () => {
    expect(
      hasAudioFromResource({ resource_type: "video", audio_codec: "" })
    ).toBe(false);
  });
});

describe("mediaKey", () => {
  it("generates a path with the user id and filename", () => {
    const key = mediaKey("user123", "photo.jpg");
    expect(key).toMatch(/^media\/user123\/\d+-photo\.jpg$/);
  });

  it("includes a timestamp component", () => {
    const before = Date.now();
    const key = mediaKey("u1", "f.png");
    const after = Date.now();
    const ts = Number(key.split("/")[2].split("-")[0]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});

describe("getThumbnailUrl", () => {
  it("returns a .poster.jpg URL for videos", async () => {
    const url = "https://abc.public.blob.vercel-storage.com/media/user1/photo.mp4";
    const result = await getThumbnailUrl(url, "video/mp4");
    expect(result).toBe(
      "https://abc.public.blob.vercel-storage.com/media/user1/photo.poster.jpg"
    );
  });

  it("returns the URL unchanged for images", async () => {
    const url = "https://abc.public.blob.vercel-storage.com/media/user1/photo.jpg";
    const result = await getThumbnailUrl(url, "image/jpeg");
    expect(result).toBe(url);
  });

  it("returns the URL unchanged when no mimeType given", async () => {
    const url = "https://abc.public.blob.vercel-storage.com/media/user1/photo.jpg";
    const result = await getThumbnailUrl(url);
    expect(result).toBe(url);
  });

  it("resolves legacy Cloudinary path to a Cloudinary URL", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "testcloud";
    const result = await getThumbnailUrl("media/user1/photo.mp4", "video/mp4");
    expect(result).toContain("res.cloudinary.com/testcloud/video/upload/media/user1/photo");
    delete process.env.CLOUDINARY_CLOUD_NAME;
  });
});

describe("getSignedDownloadUrl", () => {
  it("returns full URLs as-is", async () => {
    const url = "https://abc.public.blob.vercel-storage.com/media/user1/photo.jpg";
    const result = await getSignedDownloadUrl(url);
    expect(result).toBe(url);
  });

  it("resolves legacy Cloudinary path to a Cloudinary URL", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "testcloud";
    const result = await getSignedDownloadUrl("media/user1/photo.jpg", 3600, "image/jpeg");
    expect(result).toContain("res.cloudinary.com/testcloud/image/upload/media/user1/photo");
    delete process.env.CLOUDINARY_CLOUD_NAME;
  });
});

// Integration tests that require a real Blob store
describe.runIf(process.env.BLOB_READ_WRITE_TOKEN)(
  "uploadBuffer (integration)",
  () => {
    // Dynamic import to avoid loading @vercel/blob in unit-test mode
    it("uploads a tiny image and returns url + hasAudio", async () => {
      const { uploadBuffer, deleteObject } = await import("./storage");
      // 1x1 transparent PNG
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
        "base64"
      );
      const key = `test/${Date.now()}-test.png`;
      const result = await uploadBuffer(key, png, {
        contentType: "image/png",
      });
      expect(result.url).toMatch(/^https:\/\//);
      expect(result.hasAudio).toBe(null);
      // Clean up
      await deleteObject(result.url);
    });
  }
);
