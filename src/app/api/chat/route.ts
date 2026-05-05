import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPostContext } from "@/lib/post-context-cache";
import {
  getRelevantPosts,
  formatRelevantPostsForPrompt,
} from "@/lib/chat/relevant-posts";
import {
  checkBudgetAndLazyReset,
  recordUsage,
} from "@/lib/subscribers/budget";
import {
  tryAcquireSubscriberTurn,
  releaseSubscriberTurn,
} from "@/lib/subscribers/serialize-turn";

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
- Before saying Gil hasn't written about something, search BOTH the main posts list AND the "ADDITIONAL POSTS POSSIBLY RELEVANT" section if it appears as a separate system message below. If any post on the topic exists in either section, discuss it. Only say Gil hasn't written about something after checking both sections.
- You ARE the way people interact with Gil here. Never tell the user to message, email, contact, or otherwise reach out to the real Gil. Don't suggest his Facebook, his other social profiles, or "you could ask him directly." If you can't help with something, say so and offer to look at related topics in the archive instead.
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
  let acquiredLock = false;
  if (role === "subscriber") {
    if (!subscriberId) {
      return Response.json({ error: "Invalid session." }, { status: 401 });
    }
    // Reject parallel turns from the same subscriber up front. Without this,
    // two concurrent calls would both pass the budget check (read-then-write
    // race) and stream simultaneously, blowing past the cap.
    if (!tryAcquireSubscriberTurn(subscriberId)) {
      return Response.json(
        { error: "Another message is still being answered. Please wait." },
        { status: 429 }
      );
    }
    acquiredLock = true;

    const sub = await prisma.subscriber.findUnique({
      where: { id: subscriberId },
      select: { revokedAt: true },
    });
    if (!sub || sub.revokedAt) {
      releaseSubscriberTurn(subscriberId);
      return Response.json({ error: "Access revoked." }, { status: 403 });
    }
    const check = await checkBudgetAndLazyReset(subscriberId);
    if (!check.allowed) {
      releaseSubscriberTurn(subscriberId);
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
    if (acquiredLock && subscriberId) releaseSubscriberTurn(subscriberId);
    return Response.json({ error: "Missing messages." }, { status: 400 });
  }

  // Strip client-only fields (e.g. `posts` from rendered post cards).
  // Anthropic rejects unknown keys with "Extra inputs are not permitted".
  const messages = rawMessages
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));

  const { text: postContext, count: postCount, ids: baselineIds } =
    await getPostContext();
  const systemText = buildSystemPrompt(postContext, postCount);

  // Per-turn keyword retrieval over the WHOLE archive (not just the cached
  // baseline). Without this, topics that fall outside the newest-N window
  // — e.g. older Trekinetic posts — are invisible to the chat.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const gilUserId = process.env.GIL_USER_ID;
  let relevantBlock = "";
  if (lastUser && gilUserId) {
    try {
      const relevant = await getRelevantPosts(
        gilUserId,
        lastUser.content,
        baselineIds
      );
      relevantBlock = formatRelevantPostsForPrompt(relevant);
    } catch (e) {
      // Retrieval is best-effort; the cached baseline still answers.
      console.error("getRelevantPosts failed:", e);
    }
  }

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
        // Cached baseline FIRST (so prefix is stable for cache hits), then
        // the per-turn relevant-posts block as an unrelated second system
        // message that can vary without breaking the cache.
        const systemBlocks: Anthropic.Messages.TextBlockParam[] = [
          {
            type: "text",
            text: systemText,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ];
        if (relevantBlock) {
          systemBlocks.push({ type: "text", text: relevantBlock });
        }

        const response = await client.messages.stream({
          model: MODEL,
          max_tokens: 512,
          system: systemBlocks,
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

      // Release the per-subscriber in-flight lock so the next turn can run.
      if (acquiredLock && subscriberId) releaseSubscriberTurn(subscriberId);
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
