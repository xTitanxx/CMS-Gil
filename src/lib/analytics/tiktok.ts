// TikTok Content Posting API — Video Query
// Endpoint: POST /v2/video/query/
// Requires: video.list scope

import type { AnalyticsSnapshot } from "./types";

export async function fetchTikTokAnalytics(
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/video/query/?fields=like_count,comment_count,share_count,view_count",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filters: { video_ids: [platformPostId] },
      }),
    }
  );
  const data = await res.json();

  const video = data.data?.videos?.[0];

  return {
    impressions: null,
    reach: null,
    likes: video?.like_count ?? null,
    comments: video?.comment_count ?? null,
    shares: video?.share_count ?? null,
    saves: null,
    videoViews: video?.view_count ?? null,
    rawJson: data,
  };
}
