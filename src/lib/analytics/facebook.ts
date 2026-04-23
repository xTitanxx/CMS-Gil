// Facebook Graph API — Post Insights
// Endpoint: GET /{post-id}?fields=... and GET /{post-id}/insights
// Requires: pages_read_engagement scope + Page access token

import type { AnalyticsSnapshot } from "./types";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function fetchFacebookAnalytics(
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  // Fetch basic engagement counts from the post object
  const fieldsUrl = `${GRAPH}/${platformPostId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${accessToken}`;
  const fieldsRes = await fetch(fieldsUrl);
  const fieldsData = await fieldsRes.json();

  // Fetch post insights for impressions and reach
  const metrics = "post_impressions,post_impressions_unique";
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
    impressions: metricMap.post_impressions ?? null,
    reach: metricMap.post_impressions_unique ?? null,
    likes: fieldsData.likes?.summary?.total_count ?? null,
    comments: fieldsData.comments?.summary?.total_count ?? null,
    shares: fieldsData.shares?.count ?? null,
    saves: null,
    videoViews: null,
    rawJson: { fields: fieldsData, insights: insightsData },
  };
}
