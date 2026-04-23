// YouTube Data API v3 — Video Statistics
// Endpoint: GET /youtube/v3/videos?part=statistics&id={videoId}
// Requires: youtube.readonly scope (or youtube.upload which we already have)

import type { AnalyticsSnapshot } from "./types";

export async function fetchYouTubeAnalytics(
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${platformPostId}&access_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();

  const stats = data.items?.[0]?.statistics;

  return {
    impressions: null,
    reach: null,
    likes: stats?.likeCount != null ? Number(stats.likeCount) : null,
    comments: stats?.commentCount != null ? Number(stats.commentCount) : null,
    shares: null, // Not available via Data API
    saves: null,
    videoViews: stats?.viewCount != null ? Number(stats.viewCount) : null,
    rawJson: data,
  };
}
