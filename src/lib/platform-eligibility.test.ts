import { describe, it, expect } from "vitest";
import {
  eligiblePlatforms,
  ineligibilityReason,
  isPlatformEligible,
  mediaShapeFromMimeTypes,
} from "./platform-eligibility";

describe("platform-eligibility", () => {
  const TEXT = mediaShapeFromMimeTypes([]);
  const IMAGE = mediaShapeFromMimeTypes(["image/jpeg"]);
  const VIDEO = mediaShapeFromMimeTypes(["video/mp4"]);
  const MIXED = mediaShapeFromMimeTypes(["image/jpeg", "video/mp4"]);

  it("YouTube/TikTok require video", () => {
    expect(isPlatformEligible("YOUTUBE", TEXT)).toBe(false);
    expect(isPlatformEligible("YOUTUBE", IMAGE)).toBe(false);
    expect(isPlatformEligible("YOUTUBE", VIDEO)).toBe(true);
    expect(isPlatformEligible("YOUTUBE", MIXED)).toBe(true);
    expect(isPlatformEligible("TIKTOK", TEXT)).toBe(false);
    expect(isPlatformEligible("TIKTOK", VIDEO)).toBe(true);
  });

  it("Instagram requires photo or video", () => {
    expect(isPlatformEligible("INSTAGRAM", TEXT)).toBe(false);
    expect(isPlatformEligible("INSTAGRAM", IMAGE)).toBe(true);
    expect(isPlatformEligible("INSTAGRAM", VIDEO)).toBe(true);
  });

  it("FB Page and LinkedIn accept anything", () => {
    for (const shape of [TEXT, IMAGE, VIDEO, MIXED]) {
      expect(isPlatformEligible("FACEBOOK_PAGE", shape)).toBe(true);
      expect(isPlatformEligible("LINKEDIN", shape)).toBe(true);
    }
  });

  it("text-only posts only fit FB Page, LinkedIn, and Threads", () => {
    expect(eligiblePlatforms(TEXT)).toEqual(["FACEBOOK_PAGE", "LINKEDIN", "THREADS"]);
  });

  it("image-only posts fit FB / IG / LI / Threads", () => {
    expect(eligiblePlatforms(IMAGE)).toEqual([
      "FACEBOOK_PAGE",
      "INSTAGRAM",
      "LINKEDIN",
      "THREADS",
    ]);
  });

  it("video posts fit everything", () => {
    expect(eligiblePlatforms(VIDEO)).toEqual([
      "FACEBOOK_PAGE",
      "INSTAGRAM",
      "LINKEDIN",
      "YOUTUBE",
      "TIKTOK",
      "THREADS",
    ]);
  });

  it("returns null reason for eligible platforms, a string otherwise", () => {
    expect(ineligibilityReason("FACEBOOK_PAGE", TEXT)).toBeNull();
    expect(ineligibilityReason("YOUTUBE", TEXT)).toBe("Video required");
    expect(ineligibilityReason("INSTAGRAM", TEXT)).toBe("Photo or video required");
  });
});
