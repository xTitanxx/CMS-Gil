export interface CandidateMedia {
  id: string;
  mimeType: string;
  url: string | null;
}

export interface SuggestCandidate {
  id: string;
  body: string;
  tags: string[];
  originalDate: string;
  lastPublishedAt: string;
  publishCount: number;
  lifecycle: "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
  season: "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;
  postType: "POST" | "REEL" | "STORY";
  platformUrl: string | null;
  rating: number | null;
  thumbUrl: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  media: CandidateMedia[];
}

export interface SuggestedSlot {
  day: string;
  hour: number;
}

export interface NextCandidateResponse {
  candidate: SuggestCandidate | null;
  suggestedSlot?: SuggestedSlot;
  suggestedPlatforms?: string[];
  remaining: number;
  error?: string;
}
