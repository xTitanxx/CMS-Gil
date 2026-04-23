export interface AnalyticsSnapshot {
  impressions: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  videoViews: number | null;
  rawJson: Record<string, unknown>;
}
