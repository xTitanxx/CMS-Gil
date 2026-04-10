import { describe, it, expect } from "vitest";
import { hasAudioFromResource } from "./storage";

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
    // Cloudinary omits has_audio and audio_* fields entirely for silent videos,
    // rather than returning has_audio=false. This was the shape that broke
    // the first backfill attempt.
    expect(hasAudioFromResource({ resource_type: "video" })).toBe(false);
  });

  it("falls back to audio_codec presence when has_audio is absent", () => {
    // Defensive: some API versions may only populate audio_codec without has_audio.
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
