import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ASSISTANT_TOOLS, handleTool } from "@/lib/assistant/tools";
import { buildSystemPrompt } from "@/lib/assistant/prompt";

export const maxDuration = 60;

const client = new Anthropic();
const MAX_ITERATIONS = 6;

type PersistedBlock =
  | { kind: "text"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { conversationId, message }: { conversationId?: string; message: string } = await req.json();
  if (typeof message !== "string" || !message.trim())
    return NextResponse.json({ error: "empty message" }, { status: 400 });

  let conv = conversationId
    ? await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    : null;
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { userId, title: message.slice(0, 60) },
      include: { messages: true },
    });
  }

  const userMsg = await prisma.message.create({
    data: {
      conversationId: conv.id,
      role: "user",
      content: [{ kind: "text", text: message }] satisfies PersistedBlock[] as unknown as object,
    },
  });
  conv.messages.push(userMsg);

  const convo: Anthropic.MessageParam[] = conv.messages.map((m) => {
    const blocks = m.content as unknown as PersistedBlock[];
    if (m.role === "user") {
      const textOnly = blocks.filter(
        (b): b is Extract<PersistedBlock, { kind: "text" }> => b.kind === "text",
      );
      const toolResults = blocks.filter(
        (b): b is Extract<PersistedBlock, { kind: "tool_result" }> => b.kind === "tool_result",
      );
      if (toolResults.length) {
        return {
          role: "user",
          content: toolResults.map(
            (tr): Anthropic.ToolResultBlockParam => ({
              type: "tool_result",
              tool_use_id: tr.toolUseId,
              content: JSON.stringify(tr.result),
              is_error: !tr.result.ok,
            }),
          ),
        };
      }
      return { role: "user", content: textOnly.map((b) => b.text).join("\n") };
    }
    return {
      role: "assistant",
      content: blocks.map((b) => {
        if (b.kind === "text") return { type: "text" as const, text: b.text };
        if (b.kind === "tool_use")
          return {
            type: "tool_use" as const,
            id: b.id,
            name: b.name,
            input: b.input,
          };
        // tool_result shouldn't appear in assistant role; filter defensively
        return { type: "text" as const, text: "" };
      }).filter((x) => !(x.type === "text" && x.text === "")),
    };
  });

  const system = await buildSystemPrompt(userId, new Date());
  const encoder = new TextEncoder();
  const conversationIdFinal = conv.id;

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(JSON.stringify({ kind: "conversation", id: conversationIdFinal }) + "\n"),
      );

      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const resp = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system,
            tools: ASSISTANT_TOOLS,
            messages: convo,
          });

          const assistantBlocks: PersistedBlock[] = [];

          for (const block of resp.content) {
            if (block.type === "text") {
              assistantBlocks.push({ kind: "text", text: block.text });
              controller.enqueue(
                encoder.encode(JSON.stringify({ kind: "text", text: block.text }) + "\n"),
              );
            } else if (block.type === "tool_use") {
              assistantBlocks.push({
                kind: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    kind: "tool_use",
                    id: block.id,
                    name: block.name,
                    input: block.input,
                  }) + "\n",
                ),
              );
            }
          }

          await prisma.message.create({
            data: {
              conversationId: conversationIdFinal,
              role: "assistant",
              content: assistantBlocks as unknown as object,
            },
          });

          const toolUses = resp.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;

          convo.push({ role: "assistant", content: resp.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          const persistedToolResults: PersistedBlock[] = [];
          for (const tu of toolUses) {
            const result = await handleTool(
              tu.name,
              tu.input as Record<string, unknown>,
              { userId },
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: !result.ok,
            });
            persistedToolResults.push({
              kind: "tool_result",
              toolUseId: tu.id,
              result,
            });
            controller.enqueue(
              encoder.encode(
                JSON.stringify({ kind: "tool_result", toolUseId: tu.id, result }) + "\n",
              ),
            );
          }

          await prisma.message.create({
            data: {
              conversationId: conversationIdFinal,
              role: "user",
              content: persistedToolResults as unknown as object,
            },
          });

          convo.push({ role: "user", content: toolResults });
        }

        await prisma.conversation.update({
          where: { id: conversationIdFinal },
          data: { updatedAt: new Date() },
        });
      } catch (err) {
        console.error("/api/assistant error", err);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({ kind: "error", message: "Sorry — something broke. Try again." }) +
              "\n",
          ),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
