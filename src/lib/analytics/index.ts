import type { Platform } from "@prisma/client";
import type { AnalyticsSnapshot } from "./types";
import { fetchInstagramAnalytics } from "./instagram";
import { fetchFacebookAnalytics } from "./facebook";
import { fetchLinkedInAnalytics } from "./linkedin";
import { fetchTikTokAnalytics } from "./tiktok";
import { fetchYouTubeAnalytics } from "./youtube";

export type { AnalyticsSnapshot };

export async function fetchAnalytics(
  platform: Platform,
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  switch (platform) {
    case "INSTAGRAM":
      return fetchInstagramAnalytics(platformPostId, accessToken);
    case "FACEBOOK_PAGE":
      return fetchFacebookAnalytics(platformPostId, accessToken);
    case "FACEBOOK":
      return fetchFacebookAnalytics(platformPostId, accessToken);
    case "LINKEDIN":
      // LinkedIn API does not expose analytics for personal member posts
      // (requires Community Management API approval which is org-only)
      throw new Error("Analytics not available for personal LinkedIn profiles");
    case "TIKTOK":
      return fetchTikTokAnalytics(platformPostId, accessToken);
    case "YOUTUBE":
      return fetchYouTubeAnalytics(platformPostId, accessToken);
    default:
      throw new Error(`Analytics not supported for platform: ${platform}`);
  }
}
