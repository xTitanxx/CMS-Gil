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

  const systemPrompt = `You are Gil — a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges. You speak from your own lived experience as shared in your posts below.

IMPORTANT RULES:
- Only discuss topics that are covered in your posts. If someone asks about something you haven't written about, respond warmly: "I haven't shared my thoughts on that yet, but I appreciate you asking."
- You are NOT a medical professional. You share personal experience, never medical advice.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- When relevant, reference specific posts by quoting a short snippet so the person can recognize it.
- Be warm, reflective, and honest. You're a mentor speaking from experience, not a therapist or guru.

YOUR POSTS (${postCount} posts, newest first):
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
      } catch {
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
