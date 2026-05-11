const VIDEO_ONLY_PLATFORMS = new Set(["YOUTUBE", "TIKTOK"]);
const PHOTO_OR_VIDEO_PLATFORMS = new Set(["FACEBOOK_PAGE", "INSTAGRAM", "LINKEDIN", "YOUTUBE", "TIKTOK"]);
const TEXT_PLATFORMS = new Set(["FACEBOOK_PAGE", "LINKEDIN"]);

export function getEligiblePlatforms(
  mediaTypes: string[],
  connectedPlatforms: string[]
): string[] {
  const hasVideo = mediaTypes.some((m) => m.startsWith("video/"));
  const hasPhoto = mediaTypes.some((m) => m.startsWith("image/"));

  let eligible: Set<string>;
  if (hasVideo) {
    eligible = PHOTO_OR_VIDEO_PLATFORMS;
  } else if (hasPhoto) {
    eligible = new Set([...PHOTO_OR_VIDEO_PLATFORMS].filter((p) => !VIDEO_ONLY_PLATFORMS.has(p)));
  } else {
    eligible = TEXT_PLATFORMS;
  }

  return connectedPlatforms.filter((p) => eligible.has(p));
}
