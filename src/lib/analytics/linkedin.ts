// LinkedIn API — Social Actions (likes, comments, shares)
// Endpoint: GET /v2/socialActions/{postUrn}
// Requires: r_member_social scope (read engagement data)

import type { AnalyticsSnapshot } from "./types";

export async function fetchLinkedInAnalytics(
  platformPostId: string,
  accessToken: string
): Promise<AnalyticsSnapshot> {
  // The platformPostId from x-restli-id is already a full URN (urn:li:ugcPost:...)
  // or a raw ID that needs the ugcPost prefix
  const postUrn = platformPostId.startsWith("urn:li:")
    ? platformPostId
    : `urn:li:ugcPost:${platformPostId}`;

  const encodedUrn = encodeURIComponent(postUrn);

  const url = `https://api.linkedin.com/v2/socialActions/${encodedUrn}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`LinkedIn analytics error ${res.status}: ${text}`);
    return {
      impressions: null,
      reach: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      videoViews: null,
      rawJson: { error: res.status, body: text },
    };
  }

  const data = await res.json();

  // socialActions response has nested count summaries
  const likes = data.likesSummary?.totalLikes ?? data.likesSummary?.aggregatedTotalLikes ?? null;
  const comments = data.commentsSummary?.totalFirstLevelComments ?? data.commentsSummary?.aggregatedTotalComments ?? null;
  const shares = data.sharesSummary?.totalShares ?? null;

  return {
    impressions: null, // Not available via socialActions endpoint
    reach: null,
    likes,
    comments,
    shares,
    saves: null,
    videoViews: null,
    rawJson: data,
  };
}
