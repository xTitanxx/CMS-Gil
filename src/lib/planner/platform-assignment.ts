export type SlotGroup = "MAIN" | "VIDEO";

const MAIN_MEDIA_PLATFORMS = new Set([
  "FACEBOOK_PAGE",
  "INSTAGRAM",
  "LINKEDIN",
  "THREADS",
]);
const MAIN_TEXT_PLATFORMS = new Set(["FACEBOOK_PAGE", "LINKEDIN", "THREADS"]);
const VIDEO_PLATFORMS = new Set(["YOUTUBE", "TIKTOK"]);

export const VIDEO_ONLY_PLATFORM_NAMES = VIDEO_PLATFORMS;

export function isVideoPlatform(platform: string): boolean {
  return VIDEO_PLATFORMS.has(platform);
}

/**
 * Returns the platforms that should publish a post for a given slot.
 *
 * MAIN slots target FB Page / Instagram / LinkedIn (and text variants).
 * VIDEO slots target YouTube / TikTok and only return platforms when the post
 * actually has a video — a photo or text post in a VIDEO slot returns [] so
 * the caller can decide to skip slot creation entirely.
 */
export function getEligiblePlatforms(
  mediaTypes: string[],
  connectedPlatforms: string[],
  slotGroup: SlotGroup = "MAIN",
): string[] {
  const hasVideo = mediaTypes.some((m) => m.startsWith("video/"));
  const hasPhoto = mediaTypes.some((m) => m.startsWith("image/"));

  if (slotGroup === "VIDEO") {
    if (!hasVideo) return [];
    return connectedPlatforms.filter((p) => VIDEO_PLATFORMS.has(p));
  }

  // MAIN
  const allowed =
    hasVideo || hasPhoto ? MAIN_MEDIA_PLATFORMS : MAIN_TEXT_PLATFORMS;
  return connectedPlatforms.filter((p) => allowed.has(p));
}

/**
 * Infers a slot's group from the platforms it targets. Mixed groups (both
 * MAIN and VIDEO platforms in one call) return null — callers should reject
 * that and require two separate calls.
 */
export function inferSlotGroup(platforms: string[]): SlotGroup | null {
  let hasMain = false;
  let hasVideo = false;
  for (const p of platforms) {
    if (VIDEO_PLATFORMS.has(p)) hasVideo = true;
    else hasMain = true;
  }
  if (hasMain && hasVideo) return null;
  if (hasVideo) return "VIDEO";
  return "MAIN";
}
