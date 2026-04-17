// src/lib/analyze-post.ts
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";
import { extractFrames } from "@/lib/video-processing";

const client = new Anthropic();

const PROMPT = `Analyze this social media post and return a JSON object with these fields:
  "tags": array of 10-20 lowercase descriptive tags (subjects, scenes, mood, activities, seasonality like "spring"/"pesach"/"new-year"),
  "lifecycle": one of "EVERGREEN" (reflective/teaching/poetic; re-postable anytime), "EPHEMERAL" (tied to a dated event or current news; do not re-post), "SEASONAL" (tied to a time of year; re-postable when season returns),
  "season": one of "SPRING","SUMMER","FALL","WINTER" (only when lifecycle is SEASONAL; otherwise null).
Return ONLY the JSON object, no prose.`;

export type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
export type Season = "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;

export interface AnalyzeResult {
  tags: string[];
  lifecycle: Lifecycle;
  season: Season;
}

const LIFECYCLES = new Set(["EVERGREEN", "EPHEMERAL", "SEASONAL"]);
const SEASONS = new Set(["SPRING", "SUMMER", "FALL", "WINTER"]);

export function parseAnalyzeResponse(text: string): AnalyzeResult {
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
      const tags = Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").map((t) => t.toLowerCase())
        : [];
      const lifecycle = typeof parsed.lifecycle === "string" && LIFECYCLES.has(parsed.lifecycle)
        ? (parsed.lifecycle as Lifecycle) : "UNKNOWN";
      const season = typeof parsed.season === "string" && SEASONS.has(parsed.season)
        ? (parsed.season as Exclude<Season, null>) : null;
      return { tags, lifecycle, season };
    } catch { /* fall through */ }
  }
  const tags = parseTagsFromResponse(text);
  return { tags, lifecycle: "UNKNOWN", season: null };
}

/** Pure function — extracts a string[] from Claude's raw text response. */
export function parseTagsFromResponse(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.toLowerCase());
  } catch {
    return [];
  }
}

function inferImageMediaType(
  mimeType: string
): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/gif") return "image/gif";
  if (mimeType === "image/webp") return "image/webp";
  return "image/jpeg";
}

export async function analyzePost(postId: string): Promise<string[]> {
  const post = await prisma.post.findUnique({
    where: { id: postId },
    include: { media: true },
  });
  if (!post) return [];

  const contentBlocks: Anthropic.MessageParam["content"] = [];

  if (post.body) {
    contentBlocks.push({ type: "text", text: `Post text: ${post.body}` });
  }

  for (const media of post.media) {
    if (media.mimeType.startsWith("image/")) {
      try {
        const buf = await getObject(media.storageKey);
        contentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: inferImageMediaType(media.mimeType),
            data: buf.toString("base64"),
          },
        });
      } catch {
        // Skip unreadable media
      }
    } else if (media.mimeType.startsWith("video/")) {
      try {
        const videoBuf = await getObject(media.storageKey);
        const frames = await extractFrames(videoBuf, [0, 0.25, 0.5, 0.75, 1.0]);
        for (const f of frames) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: f.toString("base64") },
          });
        }
      } catch {
        // Skip unreadable video
      }
    }
  }

  if (contentBlocks.length === 0) {
    await prisma.post.update({ where: { id: postId }, data: { tags: [] } });
    return [];
  }

  contentBlocks.push({ type: "text", text: PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const rawText =
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "[]";
  const result = parseAnalyzeResponse(rawText);
  const data: {
    tags: string[];
    lifecycle?: Lifecycle;
    season?: Season;
  } = { tags: result.tags };
  if (!post.lifecycleOverridden) {
    data.lifecycle = result.lifecycle;
    data.season = result.season;
  }
  await prisma.post.update({ where: { id: postId }, data });

  return result.tags;
}
