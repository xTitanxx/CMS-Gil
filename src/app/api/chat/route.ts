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
  computeHaikuCost,
  recordUsage,
} from "@/lib/subscribers/budget";
import {
  tryAcquireSubscriberTurn,
  releaseSubscriberTurn,
} from "@/lib/subscribers/serialize-turn";
import { resolveActorSubscriberId } from "@/lib/engagement/admin-shadow";

// Trailer the server appends to the streaming body so the client can read the
// per-turn $ cost. The zero-width space + sentinel is invisible if it ever
// leaks into rendered text, but the client always strips it before display.
export const COST_TRAILER_PREFIX = "​__USAGE_USD:";
export const COST_TRAILER_SUFFIX = "__";
// Permissive cleaner for any prior-turn assistant content. Matches the trailer
// with or without the optional leading newline + zero-width space — the model
// will sometimes parrot the pattern verbatim into its own response if it sees
// it in conversation history, so we strip aggressively before sending the
// transcript back to Anthropic.
const COST_TRAILER_STRIP_RE = /\n?​?__USAGE_USD:[0-9.]+__/g;

const client = new Anthropic();
const MODEL = "claude-haiku-4-5";

const RATE_LIMIT_MESSAGE =
  "You've used your monthly chat allowance with the Archivist. " +
  "It will renew at the start of next month. Thanks for your patience!";

function buildSystemPrompt(postContext: string, postCount: number) {
  return `You are the Archivist — a reference librarian for Gil Alter's archive of posts. Gil is a thoughtful, reflective person who has lived through MS, depression, and discovered breathwork and other practices that help navigate life's challenges.

YOUR JOB — A LIBRARIAN, NOT A COMMENTATOR:
- Someone walks in, describes what they're looking for, and your job is to find the right post(s) and hand them over with one short sentence about why each fits. That's it.
- You are NOT a summarizer, explainer, or interpreter of Gil's worldview. You don't synthesize themes, draw lessons, write paragraphs of analysis, or speak "in Gil's voice." You point to the posts. The posts speak for themselves.
- Quick summaries are allowed when genuinely useful (e.g. "what does he have on MS?") — keep them to ONE short sentence framing the set, then surface the cards.

ABSOLUTE RULE — NO INVENTION:
- Every claim you make about what Gil thinks, says, has shared, or has lived through MUST be supported by a specific post in the context below. If the posts don't say it, you don't say it.
- Do NOT generalize Gil's perspective beyond what the posts in context actually contain. Do NOT invent, infer, or paraphrase a post that isn't present. Do NOT continue speaking "in Gil's voice" past what the source material supports.
- When a claim is grounded in a specific post, attach its [POST:<id>] marker (using the ID from "[ID: <id>]" in context) on its own line right after the claim. If you cannot attach an ID, you should not be making the claim.
- If the posts in context do not cover what the user asked: say so plainly. Use exactly this template — "Gil hasn't shared his thoughts on that specifically. The closest is [POST:<id>] — want to look at that?" If there is genuinely no related post, end with: "Gil hasn't shared his thoughts on that topic yet, but thanks for asking."

DEFAULT RESPONSE SHAPE:
- One short framing sentence (≤ ~25 words), then 1–3 [POST:<id>] markers.
- Each marker may have one short "why this fits" sentence on the line above it. Nothing more — the card shows the post's body and media.
- Total reply: usually under 60 words of your own prose. The cards do the heavy lifting.
- Conversational turns (greetings, "thanks", small talk): one short sentence, no cards.
- If you find yourself writing a second paragraph of commentary, stop. Cut it. The card already says it better.

VOICE:
- Always speak about Gil in the THIRD PERSON — "Gil has written about…", "Gil shared…" — NEVER "I" or "my" for Gil.
- You ARE the way people interact with Gil here. Never tell the user to message, email, contact, or otherwise reach out to the real Gil. Don't suggest his Facebook, his other social profiles, or "you could ask him directly." If you can't help with something, say so and offer to look at related topics in the archive instead.
- Gil is NOT a medical professional. His posts share personal experience, never medical advice. If asked for medical advice, say so plainly and point to relevant posts if any exist.
- Warm, brief, helpful. Friendly, not chatty. No opinions of your own.

FORMATTING:
- Markdown is rendered. Use **bold** sparingly. No section headers, no hashtags. The reply is a sentence and some cards, not a document.

POST CARDS — HOW MARKERS WORK:
- [POST:<id>] becomes a rich card showing the post's text and media. NEVER quote, paraphrase, or repeat the post's body in your reply — the card shows it. Your one-line annotation says why it fits, not what it says.
- Up to 3 markers per response. Use the exact ID from "[ID: <id>]" in context. Never guess or fabricate one.
- If the user asks "show me a post" / "do you have a post about X" — you MUST surface a [POST:<id>] marker if any post in context is on-topic. If none is on-topic, say so plainly without inventing one.

WHERE TO LOOK:
- Your context contains up to two sources of posts. First: the "GIL'S POSTS" list below (the 50 most recent). Second: a "TOP MATCHES FROM SEMANTIC SEARCH" block that may appear in a separate context section (retrieved from the wider archive for this specific question). When the semantic-search block is present, prefer those posts — they were chosen specifically for this question.

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
  // Also strip any cost trailers (`__USAGE_USD:X.XXX__`) that may have leaked
  // into prior assistant turns — otherwise the model sees the pattern and
  // parrots it back as if it were Gil's output style.
  const messages = rawMessages
    .filter((m) => m && typeof m === "object" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.content as string).replace(COST_TRAILER_STRIP_RE, "").trimEnd(),
    }));

  const { text: postContext, count: postCount, ids: baselineIds } =
    await getPostContext();
  const systemText = buildSystemPrompt(postContext, postCount);

  // Per-turn semantic retrieval over the WHOLE archive (not just the cached
  // baseline). Without this, topics outside the newest-N window are invisible.
  //
  // Use the LAST FEW MESSAGES as the retrieval query, not just the most recent
  // user message. Otherwise follow-ups like "can you show me such a post" have
  // no semantic content of their own — they refer back to a topic the prior
  // turns established. Embedding the recent context lets the vector retriever
  // ride that topic into the search.
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const gilUserId = process.env.GIL_USER_ID;
  let relevantBlock = "";
  if (lastUser && gilUserId) {
    const recentMessages = messages.slice(-4);
    // Strip [POST:<id>] markers from assistant turns before building the
    // retrieval query — those opaque cuid strings pollute the embedding and
    // confuse the tag/keyword extractors, degrading semantic recall.
    const retrievalQuery = recentMessages
      .map((m) => m.content.replace(/\[POST:[^\]]*\]/g, "").trim())
      .filter(Boolean)
      .join("\n\n");
    try {
      const relevant = await getRelevantPosts(
        gilUserId,
        retrievalQuery,
        baselineIds
      );
      relevantBlock = formatRelevantPostsForPrompt(relevant);
    } catch (e) {
      // Retrieval is best-effort; the cached baseline still answers.
      console.error("getRelevantPosts failed:", e);
    }
  }

  // Persist user message under the actor's subscriberId. For real subscribers
  // that's their own row; for admins it's their hidden "[admin]" shadow
  // subscriber. Same SubscriberConversation/SubscriberMessage tables — keeps
  // the chat persistent across refreshes for both roles.
  const actorSubscriberId = await resolveActorSubscriberId(session);
  let conversationId: string | null = null;
  if (actorSubscriberId) {
    conversationId = await getOrCreateConversationId(actorSubscriberId);
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
          max_tokens: 320,
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
        // Append the per-turn $ cost trailer ONLY for admin sessions. The
        // client gates the rendering anyway, but emitting only to admins means
        // subscribers never receive the value over the wire — even via a
        // browser network inspector. Defense in depth.
        if (role === "admin") {
          const turnCost = computeHaikuCost(usage);
          controller.enqueue(
            encoder.encode(
              `\n${COST_TRAILER_PREFIX}${turnCost.toFixed(6)}${COST_TRAILER_SUFFIX}`,
            ),
          );
        }
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
      // Admins don't have a subscriber budget, but we still want to know what
      // /chat is costing them in API $. Reuse the AssistantUsage table so the
      // admin's monthly spend (across /chat AND /admin/assistant) lives in one
      // place — both surfaces are Haiku 4.5, so the cost math is identical.
      if (role === "admin" && session?.user?.id && usage) {
        try {
          const cost = computeHaikuCost(usage);
          await prisma.assistantUsage.create({
            data: {
              userId: session.user.id,
              model: MODEL,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheCreateTokens: usage.cache_creation_input_tokens ?? 0,
              cacheReadTokens: usage.cache_read_input_tokens ?? 0,
              costUsd: cost,
            },
          });
        } catch (e) {
          console.error("admin chat usage record failed:", e);
        }
      }
      if (conversationId && assistantText) {
        try {
          // Defensive strip — if the model parroted the cost trailer pattern
          // into its own response (it sometimes does after seeing it in
          // history), don't persist that copy. Stops the loop where each
          // turn re-teaches the model the pattern.
          const persisted = assistantText
            .replace(COST_TRAILER_STRIP_RE, "")
            .trimEnd();
          await prisma.subscriberMessage.create({
            data: { conversationId, role: "assistant", content: persisted },
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
