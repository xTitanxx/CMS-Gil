import { describe, it, expect } from "vitest";
import { hasAudioFromResource } from "./storage";

describe("hasAudioFromResource", () => {
  it("returns null for null/undefined input", () => {
    expect(hasAudioFromResource(null)).toBe(null);
    expect(hasAudioFromResource(undefined)).toBe(null);
  });

  it("returns null for non-video resources (images, raw)", () => {
    expect(hasAudioFromResource({ resource_type: "image" })).toBe(null);
    expect(hasAudioFromResource({ resource_type: "raw" })).toBe(null);
    expect(hasAudioFromResource({ resource_type: "image", audio: { codec: "aac" } })).toBe(null);
  });

  it("returns true when video resource has a populated audio object", () => {
    expect(
      hasAudioFromResource({
        resource_type: "video",
        audio: { codec: "aac", frequency: 48000, channels: 2, bit_rate: 128000 },
      })
    ).toBe(true);
  });

  it("returns false when video resource has no audio field", () => {
    expect(hasAudioFromResource({ resource_type: "video" })).toBe(false);
  });

  it("returns false when video resource has an empty audio object (silent video)", () => {
    expect(hasAudioFromResource({ resource_type: "video", audio: {} })).toBe(false);
  });

  it("returns false when audio is null or non-object", () => {
    expect(hasAudioFromResource({ resource_type: "video", audio: null })).toBe(false);
    expect(hasAudioFromResource({ resource_type: "video", audio: "" as unknown })).toBe(false);
  });
});
