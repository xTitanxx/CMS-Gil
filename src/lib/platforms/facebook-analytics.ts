// src/lib/platforms/facebook-analytics.ts

const GRAPH_API = "https://graph.facebook.com/v21.0";
const MAX_PAGES = 5;
const PAGE_SIZE = 100;

export interface AnalyticsResult {
  reactions: number | null;
  comments: number | null;
  shares: number | null;
  reach: number | null;
  impressions: number | null;
}

/**
 * Finds the real Facebook post ID for an imported post by matching timestamp.
 * Facebook export sourceIds are synthetic (fb_{timestamp} or fb_photo_{filename})
 * and do not contain the actual Graph API post ID.
 * Matches posts whose created_time differs from originalDate by strictly less than 60 seconds.
 */
export async function discoverFacebookPostId(
  accessToken: string,
  originalDate: Date,
  sourceId: string
): Promise<string | null> {
  const targetTs = originalDate.getTime();
  const isPhoto = sourceId.startsWith("fb_photo_");
  const endpoint = isPhoto ? "me/photos" : "me/posts";

  let url: string | null =
    `${GRAPH_API}/${endpoint}?fields=id,created_time&limit=${PAGE_SIZE}&access_token=${accessToken}`;

  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error(`Facebook API HTTP ${res.status}`);
    const data = await res.json();

    if (data.error) throw new Error(`Facebook API error: ${data.error.message}`);

    const items: Array<{ id: string; created_time: string }> = data.data ?? [];

    for (const item of items) {
      const itemTs = new Date(item.created_time).getTime();
      if (Math.abs(itemTs - targetTs) < 60_000) {
        return item.id;
      }
    }

    url = data.paging?.next ?? null;
  }

  return null;
}

/**
 * Fetches engagement metrics for a known Facebook post ID.
 * Makes two parallel calls: one for reactions/comments/shares,
 * one for Professional Mode insights (reach/impressions).
 * Failures in either call are handled gracefully — the other call's data is still returned.
 */
export async function fetchPostInsights(
  accessToken: string,
  fbPostId: string
): Promise<AnalyticsResult> {
  const [engagementRes, insightsRes] = await Promise.allSettled([
    fetch(
      `${GRAPH_API}/${fbPostId}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${accessToken}`
    ),
    fetch(
      `${GRAPH_API}/${fbPostId}/insights?metric=post_impressions,post_impressions_unique&access_token=${accessToken}`
    ),
  ]);

  let reactions: number | null = null;
  let comments: number | null = null;
  let shares: number | null = null;
  let reach: number | null = null;
  let impressions: number | null = null;

  if (engagementRes.status === "fulfilled" && engagementRes.value.ok) {
    const data = await engagementRes.value.json();
    if (!data.error) {
      reactions = data.reactions?.summary?.total_count ?? null;
      comments = data.comments?.summary?.total_count ?? null;
      shares = data.shares?.count ?? null;
    }
  }

  if (insightsRes.status === "fulfilled" && insightsRes.value.ok) {
    const data = await insightsRes.value.json();
    if (!data.error && Array.isArray(data.data)) {
      for (const metric of data.data as Array<{ name: string; values: Array<{ value: number }> }>) {
        const value = metric.values?.[0]?.value ?? null;
        if (metric.name === "post_impressions_unique") reach = value;
        if (metric.name === "post_impressions") impressions = value;
      }
    }
  }

  return { reactions, comments, shares, reach, impressions };
}
