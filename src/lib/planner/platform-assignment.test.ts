import { describe, it, expect } from "vitest";
import { getEligiblePlatforms } from "./platform-assignment";

describe("getEligiblePlatforms", () => {
  const allConnected = ["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"];

  it("assigns all platforms for video posts", () => {
    const result = getEligiblePlatforms(["video/mp4", "image/jpeg"], allConnected);
    expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"]);
  });

  it("skips video-only platforms for photo-only posts", () => {
    const result = getEligiblePlatforms(["image/jpeg", "image/png"], allConnected);
    expect(result).toEqual(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN"]);
  });

  it("includes Facebook Page and LinkedIn for text-only posts", () => {
    const result = getEligiblePlatforms([], allConnected);
    expect(result).toEqual(["FACEBOOK_PAGE", "LINKEDIN"]);
  });

  it("only includes connected platforms", () => {
    const result = getEligiblePlatforms(["video/mp4"], ["INSTAGRAM", "LINKEDIN"]);
    expect(result).toEqual(["INSTAGRAM", "LINKEDIN"]);
  });
});
