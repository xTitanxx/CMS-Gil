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

const PROMPT = `Analyze this social media post and return a JSON array of descriptive lowercase tags.
Include tags for: subjects, objects, scenes, locations, activities, mood, colors, people descriptors, and any other relevant concepts.
Be thorough — aim for 10-20 tags. Return only the JSON array, no explanation.`;

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

  contentBlocks.push({ type: "text", text: PROMPT });

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: contentBlocks }],
  });

  const rawText =
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "[]";
  const tags = parseTagsFromResponse(rawText);

  await prisma.post.update({ where: { id: postId }, data: { tags } });

  return tags;
}
