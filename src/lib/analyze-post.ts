// src/lib/analyze-post.ts
import Anthropic from "@anthropic-ai/sdk";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "@/lib/prisma";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

async function fetchAsBase64(
  url: string
): Promise<{ data: string; media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp" } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get("content-type") ?? "image/jpeg";
    const media_type = (
      ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(ct)
        ? ct
        : "image/jpeg"
    ) as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    return { data: buffer.toString("base64"), media_type };
  } catch {
    return null;
  }
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
    const publicId = media.storageKey.replace(/\.[^/.]+$/, "");

    if (media.mimeType.startsWith("image/")) {
      const url = cloudinary.url(publicId, { resource_type: "image", type: "upload" });
      const img = await fetchAsBase64(url);
      if (img) {
        contentBlocks.push({
          type: "image",
          source: { type: "base64", media_type: img.media_type, data: img.data },
        });
      }
    } else if (media.mimeType.startsWith("video/")) {
      for (const offset of ["0p", "25p", "50p", "75p", "100p"]) {
        const url = cloudinary.url(publicId, {
          resource_type: "video",
          type: "upload",
          transformation: [{ start_offset: offset }],
          format: "jpg",
        });
        const img = await fetchAsBase64(url);
        if (img) {
          contentBlocks.push({
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: img.data },
          });
        }
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
