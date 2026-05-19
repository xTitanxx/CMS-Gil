import { describe, it, expect } from "vitest";
import { getEligiblePlatforms, inferSlotGroup } from "./platform-assignment";

describe("getEligiblePlatforms", () => {
  const allConnected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"];

  describe("MAIN slot", () => {
    it("returns FB Page / Instagram / LinkedIn for video posts (no YT/TT)", () => {
      const result = getEligiblePlatforms(["video/mp4", "image/jpeg"], allConnected, "MAIN");
      expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN"]);
    });

    it("returns FB Page / Instagram / LinkedIn for photo posts", () => {
      const result = getEligiblePlatforms(["image/jpeg", "image/png"], allConnected, "MAIN");
      expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN"]);
    });

    it("returns FB Page and LinkedIn for text-only posts", () => {
      const result = getEligiblePlatforms([], allConnected, "MAIN");
      expect(result).toEqual(["FACEBOOK_PAGE", "LINKEDIN"]);
    });

    it("intersects with connected platforms", () => {
      const result = getEligiblePlatforms(["video/mp4"], ["INSTAGRAM", "LINKEDIN"], "MAIN");
      expect(result).toEqual(["INSTAGRAM", "LINKEDIN"]);
    });

    it("defaults to MAIN when slotGroup is omitted", () => {
      const result = getEligiblePlatforms(["image/jpeg"], allConnected);
      expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN"]);
    });
  });

  describe("VIDEO slot", () => {
    it("returns YT/TT for video posts", () => {
      const result = getEligiblePlatforms(["video/mp4"], allConnected, "VIDEO");
      expect(result).toEqual(["YOUTUBE", "TIKTOK"]);
    });

    it("returns YT/TT for posts with both video and image", () => {
      const result = getEligiblePlatforms(["video/mp4", "image/jpeg"], allConnected, "VIDEO");
      expect(result).toEqual(["YOUTUBE", "TIKTOK"]);
    });

    it("returns [] for photo-only posts", () => {
      const result = getEligiblePlatforms(["image/jpeg"], allConnected, "VIDEO");
      expect(result).toEqual([]);
    });

    it("returns [] for text-only posts", () => {
      const result = getEligiblePlatforms([], allConnected, "VIDEO");
      expect(result).toEqual([]);
    });

    it("intersects with connected platforms", () => {
      const result = getEligiblePlatforms(["video/mp4"], ["YOUTUBE"], "VIDEO");
      expect(result).toEqual(["YOUTUBE"]);
    });

    it("returns [] when no video platforms are connected", () => {
      const result = getEligiblePlatforms(
        ["video/mp4"],
        ["FACEBOOK_PAGE", "INSTAGRAM"],
        "VIDEO",
      );
      expect(result).toEqual([]);
    });
  });

  it("includes THREADS for text posts", () => {
    const connected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "THREADS"];
    const result = getEligiblePlatforms([], connected, "MAIN");
    expect(result).toEqual(["FACEBOOK_PAGE", "LINKEDIN", "THREADS"]);
  });

  it("includes THREADS for image posts", () => {
    const connected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "THREADS"];
    const result = getEligiblePlatforms(["image/jpeg"], connected, "MAIN");
    expect(result).toEqual([
      "FACEBOOK_PAGE",
      "INSTAGRAM",
      "LINKEDIN",
      "THREADS",
    ]);
  });
});

describe("inferSlotGroup", () => {
  it("returns MAIN for FB/IG/LinkedIn", () => {
    expect(inferSlotGroup(["FACEBOOK_PAGE", "INSTAGRAM"])).toBe("MAIN");
    expect(inferSlotGroup(["LINKEDIN"])).toBe("MAIN");
  });

  it("returns VIDEO when only YT/TT", () => {
    expect(inferSlotGroup(["YOUTUBE"])).toBe("VIDEO");
    expect(inferSlotGroup(["YOUTUBE", "TIKTOK"])).toBe("VIDEO");
  });

  it("returns null for mixed groups", () => {
    expect(inferSlotGroup(["FACEBOOK_PAGE", "YOUTUBE"])).toBeNull();
    expect(inferSlotGroup(["INSTAGRAM", "TIKTOK"])).toBeNull();
  });

  it("treats FACEBOOK_PERSONAL marker as MAIN", () => {
    expect(inferSlotGroup(["FACEBOOK_PERSONAL"])).toBe("MAIN");
  });

  it("treats a THREADS-only slot as MAIN", () => {
    expect(inferSlotGroup(["THREADS"])).toBe("MAIN");
  });
});
