import { format } from "date-fns";
import type { CandidatePost, AiPickResult } from "./types";

export function buildPlannerSystemPrompt(
  candidates: CandidatePost[],
  recentHistory: { tags: string[]; publishedAt: Date; postId: string }[],
  tagDistribution: Record<string, number>,
  connectedPlatforms: string[]
): string {
  const candidateLines = candidates.map((c) => {
    const date = format(c.originalDate, "yyyy-MM-dd");
    const tags = c.tags.length > 0 ? `[${c.tags.join(", ")}]` : "[untagged]";
    const lastPub = c.lastPublishedAt ? format(c.lastPublishedAt, "yyyy-MM-dd") : "never";
    const media = c.hasVideo ? "video" : c.hasPhoto ? "photo" : "text";
    const body = c.body.slice(0, 150).replace(/\n/g, " ");
    return `ID:${c.id} | ${date} | ${tags} | published:${c.publishCount}x, last:${lastPub} | ${media} | "${body}"`;
  });

  const historyLines = recentHistory.slice(0, 50).map((h) => {
    const date = format(h.publishedAt, "yyyy-MM-dd");
    const tags = h.tags.length > 0 ? `[${h.tags.join(", ")}]` : "[untagged]";
    return `${date} ${tags} (post:${h.postId})`;
  });

  const tagLines = Object.entries(tagDistribution)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([tag, count]) => `${tag}: ${count} posts`);

  return `You are a content planning assistant for a personal social media content hub. Your job is to select posts to recycle across platforms each week.

CONNECTED PLATFORMS: ${connectedPlatforms.join(", ")}

SELECTION RULES:
1. TAG DIVERSITY: Spread different topics across the week. Don't put similar content on consecutive days.
2. PUBLISH COUNT FAIRNESS: Prefer posts with lower publishCount. Give under-shared content a chance.
3. EVERGREEN ONLY: Skip posts that are clearly time-bound — holiday-specific, news reactions, birthday posts, "today I..." with temporal context. Use your judgment.
4. RECENCY: All candidates have passed the 4-week cooldown, but still prefer posts not recycled recently.
5. ONE POST PER DAY: Select exactly one post per day, Monday through Sunday.

When explaining your picks, be specific: "You haven't posted about cooking in 3 weeks" is good. "This is a good post" is not.

TAG DISTRIBUTION (top tags across all content):
${tagLines.join("\n")}

RECENT PUBLISH HISTORY (last 6 weeks):
${historyLines.length > 0 ? historyLines.join("\n") : "(nothing published recently)"}

CANDIDATE POSTS (${candidates.length} eligible):
${candidateLines.join("\n")}`;
}

export const PLANNER_TOOLS = [
  {
    name: "plan_week" as const,
    description: "Fill all empty slots in the weekly plan with AI-recommended posts. Call this when the user says 'plan my week' or similar.",
    input_schema: {
      type: "object" as const,
      properties: {
        preferences: {
          type: "string",
          description: "Optional user preferences like 'focus on cooking' or 'nothing sad this week'",
        },
        picks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              day: { type: "string", description: "Date in YYYY-MM-DD format" },
              postId: { type: "string", description: "ID of the selected post" },
              reasoning: { type: "string", description: "Why this post was chosen for this day" },
            },
            required: ["day", "postId", "reasoning"],
          },
          description: "Array of 7 picks, one per day Monday-Sunday",
        },
      },
      required: ["picks"],
    },
  },
  {
    name: "swap_day" as const,
    description: "Replace a specific day's post with a different recommendation.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
        postId: { type: "string", description: "ID of the replacement post" },
        reasoning: { type: "string", description: "Why this replacement was chosen" },
      },
      required: ["day", "postId", "reasoning"],
    },
  },
  {
    name: "remove_day" as const,
    description: "Clear a day's slot, leaving it empty.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["day"],
    },
  },
  {
    name: "assign_post" as const,
    description: "Pin a specific post to a specific day. The user describes the post they want and you find the best match from candidates.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
        postId: { type: "string", description: "ID of the post to assign" },
        reasoning: { type: "string", description: "Confirmation of which post was matched" },
      },
      required: ["day", "postId", "reasoning"],
    },
  },
  {
    name: "explain_pick" as const,
    description: "Explain in detail why a particular day's post was chosen. Use this when the user asks 'why this post?' about a specific day.",
    input_schema: {
      type: "object" as const,
      properties: {
        day: { type: "string", description: "Date in YYYY-MM-DD format" },
      },
      required: ["day"],
    },
  },
];

export function parseAiPicks(toolInput: { picks: AiPickResult[] }): AiPickResult[] {
  return toolInput.picks.map((pick) => ({
    day: pick.day,
    postId: pick.postId,
    reasoning: pick.reasoning,
  }));
}
