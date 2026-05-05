"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Send, ArrowLeft } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { PostPreviewCard, type PreviewPost } from "./PostPreviewCard";
import { BudgetMeter } from "@/components/BudgetMeter";

interface Message {
  role: "user" | "assistant";
  content: string;
  posts?: PreviewPost[];
}

const POST_MARKER_RE = /\[POST:([^\]]+)\]/g;

function stripMarkers(text: string): string {
  return text.replace(POST_MARKER_RE, "").replace(/\n{3,}/g, "\n\n");
}

const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="mb-2 last:mb-0">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-2 last:mb-0 list-disc pl-5 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-2 last:mb-0 list-decimal pl-5 space-y-0.5">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic">{children}</em>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 text-xs">{children}</code>
  ),
};

function Markdown({ text }: { text: string }) {
  const trimmed = text.replace(/\n{3,}/g, "\n\n");
  if (!trimmed.trim()) return null;
  return <ReactMarkdown components={MARKDOWN_COMPONENTS}>{trimmed}</ReactMarkdown>;
}

function MessageContent({ content, posts }: { content: string; posts?: PreviewPost[] }) {
  if (!posts || posts.length === 0) {
    return <Markdown text={stripMarkers(content)} />;
  }

  const postMap = new Map(posts.map((p) => [p.id, p]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(POST_MARKER_RE);

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        parts.push(<Markdown key={`t-${lastIndex}`} text={textBefore} />);
      }
    }
    const post = postMap.get(match[1]);
    if (post) {
      parts.push(<PostPreviewCard key={post.id} post={post} />);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      parts.push(<Markdown key={`t-${lastIndex}`} text={remaining} />);
    }
  }

  return <>{parts}</>;
}

export default function GilChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [, setMessagesLoaded] = useState(false);
  const [budgetRefreshKey, setBudgetRefreshKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/conversation");
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: { role: "user" | "assistant"; content: string }[];
        };
        if (cancelled || data.messages.length === 0) return;

        // Re-hydrate post cards: collect every [POST:id] across all messages,
        // fetch the previews once, then attach to each assistant message.
        const allIds = new Set<string>();
        for (const m of data.messages) {
          if (m.role !== "assistant") continue;
          const re = new RegExp(POST_MARKER_RE);
          let mm: RegExpExecArray | null;
          while ((mm = re.exec(m.content)) !== null) allIds.add(mm[1]);
        }

        let postMap = new Map<string, PreviewPost>();
        if (allIds.size > 0) {
          try {
            const ids = Array.from(allIds).slice(0, 30).join(",");
            const previewRes = await fetch(`/api/posts/preview?ids=${ids}`);
            if (previewRes.ok) {
              const posts: PreviewPost[] = await previewRes.json();
              postMap = new Map(posts.map((p) => [p.id, p]));
            }
          } catch {
            // network blip: messages render without cards, text intact
          }
        }

        const hydrated: Message[] = data.messages.map((m) => {
          if (m.role !== "assistant") return m;
          const re = new RegExp(POST_MARKER_RE);
          const refs: PreviewPost[] = [];
          let mm: RegExpExecArray | null;
          while ((mm = re.exec(m.content)) !== null) {
            const p = postMap.get(mm[1]);
            if (p && !refs.find((r) => r.id === p.id)) refs.push(p);
          }
          return refs.length > 0 ? { ...m, posts: refs } : m;
        });

        if (!cancelled) setMessages(hydrated);
      } finally {
        if (!cancelled) setMessagesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming || inputDisabled) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setStreaming(true);

    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev.slice(0, -1),
          { role: "assistant", content: data.error ?? "Monthly allowance reached." },
        ]);
        setStreaming(false);
        setInputDisabled(true);
        return;
      }

      if (!res.ok || !res.body) {
        setMessages((prev) => [
          ...prev.slice(0, -1),
          {
            role: "assistant",
            content: "I'm having trouble responding right now. Please try again in a moment.",
          },
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
        });
      }

      // Extract post IDs and fetch previews
      const ids: string[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(POST_MARKER_RE);
      while ((m = re.exec(fullContent)) !== null) {
        if (!ids.includes(m[1])) ids.push(m[1]);
      }

      if (ids.length > 0) {
        try {
          const previewRes = await fetch(
            `/api/posts/preview?ids=${ids.slice(0, 3).join(",")}`
          );
          if (previewRes.ok) {
            const posts: PreviewPost[] = await previewRes.json();
            setMessages((current) => {
              const idx = current.length - 1;
              if (idx < 0) return current;
              return [
                ...current.slice(0, idx),
                { ...current[idx], posts },
              ];
            });
          }
        } catch {
          // Preview fetch failed — cards just won't show, text remains
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "assistant",
          content: "I'm having trouble connecting right now. Please try again in a moment.",
        },
      ]);
    }

    setStreaming(false);
    setBudgetRefreshKey((k) => k + 1);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const suggestions = [
    "What has Gil written about breathwork?",
    "How does Gil deal with tough days?",
    "What has Gil shared about MS?",
    "What does Gil say about depression?",
  ];

  return (
    <>
      {/* Chat header */}
      <div className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <Link
          href="/"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
          aria-label="Back to feed"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="h-10 w-10 overflow-hidden rounded-full bg-gray-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-gray-900">Virtual Gil</h1>
          <p className="text-xs text-gray-500">AI trained on Gil&apos;s posts — not the real Gil</p>
        </div>
      </div>

      {/* Messages */}
      <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4">
            <div className="h-16 w-16 overflow-hidden rounded-full bg-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Talk to Virtual Gil</p>
              <p className="text-xs text-gray-400 mt-1">Trained on Gil&rsquo;s archive.<br />Ask anything &mdash; if it exists, it will dig it up.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 mt-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    setInput(s);
                  }}
                  className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex items-end gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {msg.role === "assistant" && (
              <div className="h-7 w-7 flex-shrink-0 overflow-hidden rounded-full bg-gray-200 self-start mt-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" />
              </div>
            )}
            {msg.role === "user" ? (
              <div className="max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap bg-blue-600 text-white rounded-br-sm">
                {msg.content}
              </div>
            ) : (
              <div
                className={`text-sm whitespace-pre-wrap text-gray-800 ${
                  msg.posts && msg.posts.length > 0
                    ? "max-w-[85%]"
                    : "max-w-[75%] rounded-2xl px-4 py-2.5 bg-white border border-gray-200 rounded-bl-sm"
                }`}
              >
                {msg.posts && msg.posts.length > 0 ? (
                  <div className="flex flex-col gap-0">
                    <div className="rounded-2xl px-4 py-2.5 bg-white border border-gray-200 rounded-bl-sm">
                      <MessageContent content={msg.content} posts={msg.posts} />
                    </div>
                  </div>
                ) : (
                  <>
                    <MessageContent content={msg.content} />
                    {streaming &&
                      i === messages.length - 1 &&
                      msg.content === "" && (
                        <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm" />
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <BudgetMeter refreshKey={budgetRefreshKey} />

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Virtual Gil..."
            rows={1}
            disabled={inputDisabled || streaming}
            className="flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:bg-white transition-colors disabled:opacity-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || inputDisabled}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
