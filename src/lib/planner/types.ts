export interface CandidatePost {
  id: string;
  body: string;
  tags: string[];
  originalDate: Date;
  publishCount: number;
  lastPublishedAt: Date | null;
  mediaTypes: string[];
  hasVideo: boolean;
  hasPhoto: boolean;
  thumbUrl: string | null;
}

export interface PlanSlotData {
  id: string;
  day: string;
  postId: string;
  status: "PROPOSED" | "APPROVED" | "SCHEDULED" | "SKIPPED";
  reasoning: string | null;
  platforms: string[];
  post: {
    id: string;
    body: string;
    tags: string[];
    originalDate: string;
    publishCount: number;
    thumbUrl: string | null;
    hasVideo: boolean;
  };
}

export interface WeeklyPlanData {
  id: string;
  weekStart: string;
  status: "DRAFT" | "PARTIAL" | "APPROVED";
  slots: PlanSlotData[];
}

export interface AiPickResult {
  day: string;
  postId: string;
  reasoning: string;
}
