import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createRateLimiter } from "@/lib/rate-limit";
import { getPostContext } from "@/lib/post-context-cache";

const client = new Anthropic();

const rateLimiter = createRateLimiter({
  maxRequests: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
});

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

const RATE_LIMIT_MESSAGE =
  "Hey, thanks so much for chatting with me! I'm still in early development " +
  "and can only handle a limited number of messages right now. Please come " +
  "back in a bit — I'd love to continue our conversation. This will get " +
  "better over time!";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limit = rateLimiter.check(ip);

  if (!limit.allowed) {
    return Response.json(
      { error: RATE_LIMIT_MESSAGE },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil((limit.retryAfterMs ?? 60_000) / 1000)),
        },
      }
    );
  }

  const { messages } = await req.json();

  const { text: postContext, count: postCount } = await getPostContext();

  const systemPrompt = `You are Virtual Gil — an AI assistant that helps people explore Gil Alter's archive of posts. Gil is a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges.

IMPORTANT RULES:
- Always speak about Gil in the THIRD PERSON. Say "Gil has written about…", "Gil shared…", "In Gil's experience…" — NEVER "I" or "my".
- Only discuss topics covered in Gil's posts below. If someone asks about something Gil hasn't written about, say: "Gil hasn't shared his thoughts on that topic yet, but thanks for asking."
- Before saying Gil hasn't written about something, carefully search through ALL the posts below. If there are posts on the topic, discuss them — never claim Gil hasn't written about a topic when posts exist about it.
- Gil is NOT a medical professional. His posts share personal experience, never medical advice. Make this clear.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- Be warm and helpful. You're a guide to Gil's archive, helping people find relevant reflections.

REFERENCING POSTS:
- When your answer draws from specific posts, embed up to 3 post markers in your response using exactly this format: [POST:<id>]
- Place each marker on its own line, right after the paragraph where you discuss that post's content.
- The marker will be rendered as a rich card showing the post — do NOT also quote the post text. Just discuss the idea naturally, then place the marker.
- Only reference posts that are directly relevant to what the person asked. Do not force references.
- Each post has an ID shown as [ID: <id>] in the context below. Use that exact ID in markers.

GIL'S POSTS (${postCount} posts, newest first):
---
${postContext}
---`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: "claude-haiku-4-5",
          max_tokens: 1024,
          system: systemPrompt,
          messages,
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
      } catch (err) {
        console.error("Chat API error:", err);
        controller.enqueue(
          encoder.encode("I'm having trouble responding right now. Please try again in a moment.")
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
