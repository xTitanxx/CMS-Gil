"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { PostCard } from "./PostCard";
import { PlanCard, type PlanProposal } from "./PlanCard";

type UiMsg =
  | { role: "user" | "assistant"; kind: "text"; text: string }
  | {
      role: "assistant";
      kind: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      role: "assistant";
      kind: "tool_result";
      toolUseId: string;
      result: { ok: boolean; data?: unknown; error?: string };
    };

const SUGGESTIONS = [
  "What should I post today?",
  "Find me a post about breathwork",
  "Show me next week's schedule",
  "Rate my last 5 posts",
];

function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export function ThreadView() {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pendingPlan, setPendingPlan] = useState<PlanProposal | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Resume latest thread on mount
  useEffect(() => {
    fetch("/api/assistant/thread")
      .then((r) => r.json())
      .then((d) => {
        if (!d.conversation) return;
        setConversationId(d.conversation.id);
        const rehydrated: UiMsg[] = [];
        for (const m of d.conversation.messages as { role: string; content: unknown[] }[]) {
          for (const block of m.content) {
            const b = block as { kind: string };
            if (b.kind === "text") {
              rehydrated.push({
                role: m.role as "user" | "assistant",
                kind: "text",
                text: (b as unknown as { text: string }).text,
              });
            } else if (b.kind === "tool_use") {
              rehydrated.push({
                role: "assistant",
                kind: "tool_use",
                ...(b as unknown as { id: string; name: string; input: Record<string, unknown> }),
              });
            } else if (b.kind === "tool_result") {
              rehydrated.push({
                role: "assistant",
                kind: "tool_result",
                ...(b as unknown as { toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } }),
              });
            }
          }
        }
        setMessages(rehydrated);
      })
      .catch(() => {
        /* no saved thread yet */
      });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function send(text: string) {
    const userMsg: UiMsg = { role: "user", kind: "text", text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setStreaming(true);

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (!res.body) {
      setStreaming(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const evt = JSON.parse(line);
          if (evt.kind === "conversation") {
            setConversationId(evt.id);
          } else if (evt.kind === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.kind === "text") {
                return [...prev.slice(0, -1), { ...last, text: last.text + evt.text }];
              }
              return [...prev, { role: "assistant", kind: "text", text: evt.text }];
            });
          } else if (evt.kind === "tool_use") {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                kind: "tool_use",
                id: evt.id,
                name: evt.name,
                input: evt.input,
              },
            ]);
          } else if (evt.kind === "tool_result") {
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                kind: "tool_result",
                toolUseId: evt.toolUseId,
                result: evt.result,
              },
            ]);
          }
        } catch {
          /* swallow partial/bad lines */
        }
      }
    }
    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = input.trim();
      if (v && !streaming) send(v);
    }
  }

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      return (
        <div
          key={key}
          className={`flex items-end gap-2 ${
            m.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          {m.role === "assistant" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
          )}
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "bg-blue-600 text-white rounded-br-sm"
                : "border border-gray-200 bg-white text-gray-800 shadow-sm rounded-bl-sm"
            }`}
          >
            {m.text}
          </div>
        </div>
      );
    }
    if (m.kind === "tool_use") {
      return (
        <div key={key} className="flex items-center gap-1.5 pl-10 text-xs text-gray-400">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{m.name}</span>
        </div>
      );
    }
    if (m.kind === "tool_result") {
      if (!m.result.ok) {
        return (
          <div key={key} className="pl-10 text-xs text-red-500">
            error: {m.result.error}
          </div>
        );
      }
      const data = m.result.data as unknown;
      if (Array.isArray(data)) {
        return (
          <div key={key} className="ml-10 space-y-2">
            {(
              data as {
                postId: string;
                body?: string;
                tags?: string[];
                stars?: number | null;
                lifecycle?: string | null;
                thumbUrl?: string | null;
                reasons?: string[];
                matchReasons?: string[];
                score?: number;
              }[]
            )
              .slice(0, 5)
              .map((r) => (
                <PostCard
                  key={r.postId}
                  data={{
                    postId: r.postId,
                    body: r.body,
                    tags: r.tags,
                    stars: r.stars,
                    lifecycle: r.lifecycle,
                    thumbUrl: r.thumbUrl,
                    reasons: r.reasons ?? r.matchReasons,
                    score: r.score,
                  }}
                  onSchedule={(postId) =>
                    setPendingPlan({
                      postId,
                      platform: "instagram",
                      scheduledAt: defaultWhen(),
                    })
                  }
                />
              ))}
          </div>
        );
      }
      return null;
    }
    return null;
  }

  return (
    <div className="flex h-full flex-col bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-3">
        <div className="rounded-full bg-blue-100 p-1.5">
          <Sparkles className="h-4 w-4 text-blue-600" />
        </div>
        <div className="flex-1">
          <h1 className="text-sm font-semibold text-gray-900">Assistant</h1>
          <p className="text-xs text-gray-500">
            Ask about the archive, rate, edit, or schedule posts
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="mb-4 rounded-full bg-blue-100 p-3">
                <Sparkles className="h-6 w-6 text-blue-600" />
              </div>
              <p className="text-sm font-medium text-gray-700">Your content assistant</p>
              <p className="mt-1 max-w-sm text-xs text-gray-500">
                Ask what to post, find things in your archive, edit or rate posts, or schedule
                publishing.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => renderMsg(m, i))}

          {streaming && (
            <div className="flex items-end gap-2 justify-start">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <span className="text-xs text-gray-500">Thinking…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Plan confirmation */}
      {pendingPlan && (
        <div className="mx-auto w-full max-w-3xl px-4 pb-2">
          <PlanCard
            proposal={pendingPlan}
            onConfirm={async () => {
              const msg = `Schedule post ${pendingPlan.postId} on ${pendingPlan.platform} at ${pendingPlan.scheduledAt}.`;
              setPendingPlan(null);
              await send(msg);
            }}
            onCancel={() => setPendingPlan(null)}
          />
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the archive, or what to post…"
            rows={1}
            disabled={streaming}
            className="flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-60"
            style={{ maxHeight: "120px" }}
          />
          <button
            onClick={() => {
              const v = input.trim();
              if (v && !streaming) send(v);
            }}
            disabled={!input.trim() || streaming}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
            aria-label="Send"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-[11px] text-gray-400">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
