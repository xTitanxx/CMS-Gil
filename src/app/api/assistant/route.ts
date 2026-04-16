import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/lib/auth";
import { ASSISTANT_TOOLS, handleTool } from "@/lib/assistant/tools";
import { buildSystemPrompt } from "@/lib/assistant/prompt";

export const maxDuration = 60;

const client = new Anthropic();
const MAX_ITERATIONS = 6;

interface ClientMessage {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { messages }: { messages: ClientMessage[] } = await req.json();

  const system = await buildSystemPrompt(userId, new Date());
  const encoder = new TextEncoder();

  const convo: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for (let i = 0; i < MAX_ITERATIONS; i++) {
          const resp = await client.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            system,
            tools: ASSISTANT_TOOLS,
            messages: convo,
          });

          for (const block of resp.content) {
            if (block.type === "text") {
              controller.enqueue(
                encoder.encode(
                  JSON.stringify({ kind: "text", text: block.text }) + "\n",
                ),
              );
            } else if (block.type === "tool_use") {
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

          const toolUses = resp.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0 || resp.stop_reason !== "tool_use") break;

          convo.push({ role: "assistant", content: resp.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
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
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  kind: "tool_result",
                  toolUseId: tu.id,
                  result,
                }) + "\n",
              ),
            );
          }
          convo.push({ role: "user", content: toolResults });
        }
      } catch (err) {
        console.error("/api/assistant error", err);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              kind: "error",
              message: "Sorry — something broke. Try again.",
            }) + "\n",
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
