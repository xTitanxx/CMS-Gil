export interface CandidatePost {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
  publishCount: number;
  lastPublishedAt: Date;
  mediaTypes: string[];
  hasVideo: boolean;
  hasPhoto: boolean;
  thumbUrl: string | null;
}

export interface PlanSlotData {
  id: string;
  day: string;
  /** Hour-of-day this slot will publish at (Asia/Jerusalem). One of FIXED_SLOT_HOURS.
   *  Null if no slot time can be computed (shouldn't happen in practice). */
  hour: number | null;
  postId: string;
  status: "PROPOSED" | "APPROVED" | "SCHEDULED" | "SKIPPED";
  reasoning: string | null;
  platforms: string[];
  /** True when this slot's PublishRecord has already fired (status PUBLISHED).
   *  Derived server-side; the post-first Planner view greys these and hides
   *  destructive actions. */
  published: boolean;
  post: {
    id: string;
    body: string;
    tags: string[];
    originalDate: string;
    publishCount: number;
    lastPublishedAt: string;
    thumbUrl: string | null;
    hasVideo: boolean;
    lifecycle: "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
    season: "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;
    rating: number | null;
    postType: "POST" | "REEL" | "STORY";
    mediaCount: number;
    hasAudio: boolean;
    platformUrl: string | null;
  };
}

export type PlanMode = "AI" | "DUMB";

export interface WeeklyPlanData {
  id: string;
  weekStart: string;
  status: "DRAFT" | "PARTIAL" | "APPROVED";
  mode: PlanMode;
  slots: PlanSlotData[];
}

export interface AiPickResult {
  day: string;
  hour: number;
  postId: string;
  reasoning: string;
}
