// Instagram Graph API — Media Insights
// Endpoint: GET /{ig-media-id}/insights
// Requires: instagram_business_basic scope + Professional account

import type { AnalyticsSnapshot } from "./types";

const GRAPH = "https://graph.instagram.com/v21.0";

export async function fetchInstagramAnalytics(
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  // Fetch basic engagement fields directly from the media object
  const fieldsUrl = `${GRAPH}/${platformPostId}?fields=like_count,comments_count,timestamp&access_token=${accessToken}`;
  const fieldsRes = await fetch(fieldsUrl);
  const fieldsData = await fieldsRes.json();

  // Fetch insights (impressions, reach, saved, shares)
  // Metrics differ by media type; request all and handle missing gracefully
  const metrics = "impressions,reach,saved,shares";
  const insightsUrl = `${GRAPH}/${platformPostId}/insights?metric=${metrics}&access_token=${accessToken}`;
  const insightsRes = await fetch(insightsUrl);
  const insightsData = await insightsRes.json();

  const metricMap: Record<string, number> = {};
  if (insightsData.data) {
    for (const entry of insightsData.data) {
      metricMap[entry.name] = entry.values?.[0]?.value ?? 0;
    }
  }

  return {
    impressions: metricMap.impressions ?? null,
    reach: metricMap.reach ?? null,
    likes: fieldsData.like_count ?? null,
    comments: fieldsData.comments_count ?? null,
    shares: metricMap.shares ?? null,
    saves: metricMap.saved ?? null,
    videoViews: null, // video_views deprecated for non-Reels
    rawJson: { fields: fieldsData, insights: insightsData },
  };
}
