import type { Lifecycle, PostType, Season } from "@prisma/client";

export type Platform = "instagram" | "facebook" | "linkedin" | "tiktok" | "youtube";

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
}

export interface RecommendOptions {
  userId: string;
  when?: Date;
  platform?: Platform;
  kind?: PostType;
  excludePostIds?: string[];
  limit?: number;
}

export interface RetrieveOptions {
  userId: string;
  query: string;
  limit?: number;
  lifecycle?: Lifecycle;
  season?: Season;
  dateRange?: { from?: Date; to?: Date };
}

export interface RetrieveHit {
  postId: string;
  score: number;
  matchReasons: string[];
  highlightSnippet: string;
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
}
