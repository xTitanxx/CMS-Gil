import { describe, it, expect } from "vitest";
import { mediaKey, audioKey, getThumbnailUrl, getSignedDownloadUrl } from "./storage";

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

describe("audioKey", () => {
  it("generates a path with the audio/ prefix", () => {
    const key = audioKey("user123", "track.mp3");
    expect(key).toMatch(/^audio\/user123\/\d+-track\.mp3$/);
  });
});

describe("getThumbnailUrl", () => {
  it("returns a .poster.jpg URL for videos", async () => {
    const url = "https://pub-abc.r2.dev/media/user1/photo.mp4";
    const result = await getThumbnailUrl(url, "video/mp4");
    expect(result).toBe("https://pub-abc.r2.dev/media/user1/photo.poster.jpg");
  });

  it("returns the URL unchanged for images", async () => {
    const url = "https://pub-abc.r2.dev/media/user1/photo.jpg";
    const result = await getThumbnailUrl(url, "image/jpeg");
    expect(result).toBe(url);
  });

  it("returns the URL unchanged when no mimeType given", async () => {
    const url = "https://pub-abc.r2.dev/media/user1/photo.jpg";
    const result = await getThumbnailUrl(url);
    expect(result).toBe(url);
  });
});

describe("getSignedDownloadUrl", () => {
  it("returns the URL as-is", async () => {
    const url = "https://pub-abc.r2.dev/media/user1/photo.jpg";
    const result = await getSignedDownloadUrl(url);
    expect(result).toBe(url);
  });
});

// Integration tests that require a real R2 store
describe.runIf(process.env.R2_ENDPOINT)(
  "uploadBuffer (integration)",
  () => {
    it("uploads a tiny image and returns url + hasAudio", async () => {
      const { uploadBuffer, deleteObject } = await import("./storage");
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
      await deleteObject(result.url);
    });
  }
);
