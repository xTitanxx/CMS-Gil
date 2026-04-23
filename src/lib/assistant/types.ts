import type { Lifecycle, PostType, Season } from "@prisma/client";
import type { ContentKind } from "./classify";

export type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube";

export type { ContentKind } from "./classify";

export interface ScoreBreakdown {
  ratingScore: number;
  lifecycleFit: number;
  freshness: number;
  tagVariety: number;
  kindDiversity: number;
  penaltyReasons: number;
  total: number;
}

export interface Recommendation {
  postId: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasons: string[];
  // UI-facing preview fields — populated by `recommend()` and `retrieve()`:
  body: string;
  tags: string[];
  stars: number | null;
  lifecycle: Lifecycle;
  thumbUrl: string | null;
  contentKind: ContentKind;
  platformUrl: string | null;
}

export interface RecommendOptions {
  userId: string;
  when?: Date;
  platform?: Platform;
  kind?: PostType;
  contentKind?: ContentKind;
  excludePostIds?: string[];
  limit?: number;
}

export interface RetrieveOptions {
  userId: string;
  query: string;
  limit?: number;
  lifecycle?: Lifecycle;
  season?: Season;
  contentKind?: ContentKind;
  dateRange?: { from?: Date; to?: Date };
}

export interface RetrieveHit {
  postId: string;
  score: number;
  matchReasons: string[];
  highlightSnippet: string;
  body: string;
  tags: string[];
  stars: number | null;
  lifecycle: Lifecycle;
  thumbUrl: string | null;
  contentKind: ContentKind;
  platformUrl: string | null;
}

export interface CandidateRow {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
  lifecycle: Lifecycle;
  season: Season | null;
  postType: PostType;
  publishCount: number;
  stars: number | null;
  ratingReasons: string[];
  lastPublishedAt: Date | null;
  thumbUrl: string | null;
  contentKind: ContentKind;
  platformUrl: string | null;
}
