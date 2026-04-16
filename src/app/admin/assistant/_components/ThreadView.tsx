"use client";
import { useState, useRef } from "react";
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

function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

export function ThreadView() {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<PlanProposal | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  async function send(text: string) {
    const userMsg: UiMsg = { role: "user", kind: "text", text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setStreaming(true);

    const history = nextMessages
      .filter((m) => m.kind === "text")
      .map((m) => ({ role: m.role, content: (m as { text: string }).text }));

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
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
          if (evt.kind === "text") {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === "assistant" && last.kind === "text") {
                return [
                  ...prev.slice(0, -1),
                  { ...last, text: last.text + evt.text },
                ];
              }
              return [
                ...prev,
                { role: "assistant", kind: "text", text: evt.text },
              ];
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

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      return (
        <div key={key} className={m.role === "user" ? "text-right" : ""}>
          <span
            className={
              "inline-block px-3 py-2 rounded-lg text-sm " +
              (m.role === "user" ? "bg-blue-100" : "bg-gray-100")
            }
          >
            {m.text}
          </span>
        </div>
      );
    }
    if (m.kind === "tool_use") {
      return (
        <div key={key} className="text-xs text-gray-500">
          → {m.name}(…)
        </div>
      );
    }
    if (m.kind === "tool_result") {
      if (!m.result.ok)
        return (
          <div key={key} className="text-xs text-red-600">
            error: {m.result.error}
          </div>
        );
      const data = m.result.data as unknown;
      if (Array.isArray(data)) {
        return (
          <div key={key} className="space-y-2">
            {(
              data as {
                postId: string;
                reasons?: string[];
                score?: number;
                matchReasons?: string[];
                body?: string;
                tags?: string[];
                stars?: number | null;
                lifecycle?: string | null;
                thumbUrl?: string | null;
              }[]
            )
              .slice(0, 5)
              .map((r) => (
                <PostCard
                  key={r.postId}
                  data={{
                    postId: r.postId,
                    reasons: r.reasons ?? r.matchReasons,
                    score: r.score,
                    body: r.body,
                    tags: r.tags,
                    stars: r.stars,
                    lifecycle: r.lifecycle,
                    thumbUrl: r.thumbUrl,
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
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-3 p-4">
        {messages.map((m, i) => renderMsg(m, i))}
        {streaming && <p className="text-xs text-gray-400">…</p>}
      </div>
      {pendingPlan && (
        <PlanCard
          proposal={pendingPlan}
          onConfirm={async () => {
            const msg = `Schedule post ${pendingPlan.postId} on ${pendingPlan.platform} at ${pendingPlan.scheduledAt}.`;
            setPendingPlan(null);
            await send(msg);
          }}
          onCancel={() => setPendingPlan(null)}
        />
      )}
      <form
        className="border-t p-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = inputRef.current?.value?.trim();
          if (!v) return;
          send(v);
          if (inputRef.current) inputRef.current.value = "";
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          className="flex-1 border rounded p-2 text-sm"
          placeholder="Ask about the archive, or what to post…"
        />
        <button
          disabled={streaming}
          className="px-3 bg-black text-white rounded text-sm"
        >
          Send
        </button>
      </form>
    </div>
  );
}
