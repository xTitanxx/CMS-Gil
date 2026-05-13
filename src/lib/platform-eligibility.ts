// Client-side platform eligibility — mirrors the server helper in
// `src/lib/planner/platform-assignment.ts` but stays decoupled from connected
// platforms so it's safe to pull into picker UIs without a connection probe.
//
// Rules:
//   - YouTube / TikTok: video required.
//   - Instagram: at least one image or video required (no text-only).
//   - Facebook Page / LinkedIn: any content (text, image, or video).
//
// Story / Reel postTypes don't loosen the rules above — IG/FB Reels need
// video, IG/FB Stories need image-or-video — but the basic media-type gate
// already covers the failure modes we care about ("don't let the user select
// YouTube for a text post").

export const ALL_PUBLISHABLE_PLATFORMS = [
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "YOUTUBE",
  "TIKTOK",
] as const;

export type PublishablePlatform = (typeof ALL_PUBLISHABLE_PLATFORMS)[number];

export interface MediaShape {
  hasVideo: boolean;
  hasImage: boolean;
}

export function mediaShapeFromMimeTypes(mimeTypes: readonly string[]): MediaShape {
  return {
    hasVideo: mimeTypes.some((m) => m.startsWith("video/")),
    hasImage: mimeTypes.some((m) => m.startsWith("image/")),
  };
}

export function isPlatformEligible(
  platform: PublishablePlatform | string,
  shape: MediaShape
): boolean {
  const { hasVideo, hasImage } = shape;
  switch (platform) {
    case "YOUTUBE":
    case "TIKTOK":
      return hasVideo;
    case "INSTAGRAM":
      return hasVideo || hasImage;
    case "FACEBOOK_PAGE":
    case "LINKEDIN":
      return true;
    default:
      return false;
  }
}

export function eligiblePlatforms(
  shape: MediaShape,
  candidates: readonly (PublishablePlatform | string)[] = ALL_PUBLISHABLE_PLATFORMS
): string[] {
  return candidates.filter((p) => isPlatformEligible(p, shape));
}

// Short label explaining why a platform isn't eligible — used as a tooltip
// on a disabled chip. Returns null when the platform is eligible.
export function ineligibilityReason(
  platform: PublishablePlatform | string,
  shape: MediaShape
): string | null {
  if (isPlatformEligible(platform, shape)) return null;
  if (platform === "YOUTUBE" || platform === "TIKTOK") return "Video required";
  if (platform === "INSTAGRAM") return "Photo or video required";
  return "Not eligible";
}
