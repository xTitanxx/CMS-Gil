import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPostContext } from "@/lib/post-context-cache";
import {
  checkBudgetAndLazyReset,
  recordUsage,
} from "@/lib/subscribers/budget";

const client = new Anthropic();
const MODEL = "claude-haiku-4-5";

const RATE_LIMIT_MESSAGE =
  "You've used your monthly chat allowance with virtual Gil. " +
  "It will renew at the start of next month. Thanks for your patience!";

function buildSystemPrompt(postContext: string, postCount: number) {
  return `You are Virtual Gil — an AI assistant that helps people explore Gil Alter's archive of posts. Gil is a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges.

IMPORTANT RULES:
- Always speak about Gil in the THIRD PERSON. Say "Gil has written about…", "Gil shared…", "In Gil's experience…" — NEVER "I" or "my".
- Only discuss topics covered in Gil's posts below. If someone asks about something Gil hasn't written about, say: "Gil hasn't shared his thoughts on that topic yet, but thanks for asking."
- Before saying Gil hasn't written about something, carefully search through ALL the posts below. If there are posts on the topic, discuss them — never claim Gil hasn't written about a topic when posts exist about it.
- Gil is NOT a medical professional. His posts share personal experience, never medical advice. Make this clear.
- Be conversational and concise — this is a chat, not an essay. Keep responses to 2-4 short paragraphs max.
- Be warm and helpful. You're a guide to Gil's archive, helping people find relevant reflections.

FORMATTING:
- Markdown is rendered. Use **bold** for emphasis, *italics* for nuance, and dash-style bullet lists when listing 2+ short items. Don't overuse formatting — most replies are 2–4 short paragraphs of plain prose. No hashtags for headers (the chat is a conversation, not a document).

REFERENCING POSTS:
- When your answer draws from specific posts, embed up to 3 post markers in your response using exactly this format: [POST:<id>]
- Place each marker on its own line, right after the paragraph where you discuss that post's content.
- The marker becomes a rich card displaying the post's text and media. NEVER quote, paraphrase, summarize, or repeat the post's body in your reply when you embed a marker for it. Just say a single short sentence introducing why the post is relevant, then drop the marker on its own line — the card shows the rest.
- Only reference posts that are directly relevant to what the person asked. Do not force references.
- Each post has an ID shown as [ID: <id>] in the context below. Use that exact ID in markers.

GIL'S POSTS (${postCount} posts, newest first):
---
${postContext}
---`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role;
  const subscriberId = session?.user?.subscriberId;

  if (!session) {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  // Subscriber budget gate (admin bypasses)
  if (role === "subscriber") {
    if (!subscriberId) {
      return Response.json({ error: "Invalid session." }, { status: 401 });
    }
    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      return Response.json({ error: "Access revoked." }, { status: 403 });
    }
    const check = await checkBudgetAndLazyReset(subscriberId);
    if (!check.allowed) {
      return Response.json(
        {
          error: RATE_LIMIT_MESSAGE,
          cycleResetsAt: check.cycleResetsAt.toISOString(),
        },
        { status: 429 }
      );
    }
  }

  const { messages: rawMessages } = await req.json();
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }

  // Strip client-only fields (e.g. `posts` from rendered post cards).
  // Anthropic rejects unknown keys with "Extra inputs are not permitted".
  const messages = rawMessages
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

  const { text: postContext, count: postCount } = await getPostContext();
  const systemText = buildSystemPrompt(postContext, postCount);

  // Persist user message immediately (subscriber path only)
  let conversationId: string | null = null;
  if (role === "subscriber" && subscriberId) {
    conversationId = await getOrCreateConversationId(subscriberId);
    const last = messages[messages.length - 1];
    if (last?.role === "user" && typeof last.content === "string") {
      await prisma.subscriberMessage.create({
        data: { conversationId, role: "user", content: last.content },
      });
    }
  }

  const encoder = new TextEncoder();
  let usage: Anthropic.Messages.Message["usage"] | null = null;
  let assistantText = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.messages.stream({
          model: MODEL,
          max_tokens: 1024,
          system: [
            {
              type: "text",
              text: systemText,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        });

        for await (const chunk of response) {
          if (
            chunk.type === "content_block_delta" &&
            chunk.delta.type === "text_delta"
          ) {
            assistantText += chunk.delta.text;
            controller.enqueue(encoder.encode(chunk.delta.text));
          }
        }
        const finalMessage = await response.finalMessage();
        usage = finalMessage.usage;
      } catch (err) {
        console.error("Chat API error:", err);
        controller.enqueue(
          encoder.encode("I'm having trouble responding right now. Please try again in a moment.")
        );
      }
      controller.close();

      // After the stream is closed, persist usage + assistant message.
      if (role === "subscriber" && subscriberId && usage) {
        try {
          await recordUsage({ subscriberId, usage });
        } catch (e) {
          console.error("recordUsage failed:", e);
        }
      }
      if (conversationId && assistantText) {
        try {
          await prisma.subscriberMessage.create({
            data: { conversationId, role: "assistant", content: assistantText },
          });
          await prisma.subscriberConversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });
        } catch (e) {
          console.error("persist assistant message failed:", e);
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function getOrCreateConversationId(subscriberId: string): Promise<string> {
  const existing = await prisma.subscriberConversation.findFirst({
    where: { subscriberId },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.subscriberConversation.create({
    data: { subscriberId },
    select: { id: true },
  });
  return created.id;
}
