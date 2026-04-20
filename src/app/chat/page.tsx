"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Send, ArrowLeft } from "lucide-react";
import { PostPreviewCard, type PreviewPost } from "./PostPreviewCard";

interface Message {
  role: "user" | "assistant";
  content: string;
  posts?: PreviewPost[];
}

const POST_MARKER_RE = /\[POST:([^\]]+)\]/g;

function stripMarkers(text: string): string {
  return text.replace(POST_MARKER_RE, "").replace(/\n{3,}/g, "\n\n");
}

function MessageContent({ content, posts }: { content: string; posts?: PreviewPost[] }) {
  if (!posts || posts.length === 0) {
    return <>{stripMarkers(content)}</>;
  }

  const postMap = new Map(posts.map((p) => [p.id, p]));
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(POST_MARKER_RE);

  while ((match = re.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).replace(/\n{3,}/g, "\n\n");
      if (textBefore.trim()) {
        parts.push(<span key={`t-${lastIndex}`}>{textBefore}</span>);
      }
    }
    const post = postMap.get(match[1]);
    if (post) {
      parts.push(<PostPreviewCard key={post.id} post={post} />);
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).replace(/\n{3,}/g, "\n\n");
    if (remaining.trim()) {
      parts.push(<span key={`t-${lastIndex}`}>{remaining}</span>);
    }
  }

  return <>{parts}</>;
}

export default function GilChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

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
          { role: "assistant", content: data.error },
        ]);
        setStreaming(false);
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
              <p className="text-xs text-gray-400 mt-1">An AI guide to Gil&apos;s archive — ask about MS, breathwork, depression, and more</p>
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

      {/* Input */}
      <div className="border-t border-gray-200 bg-white px-4 py-3 flex-shrink-0">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Virtual Gil..."
            rows={1}
            className="flex-1 resize-none rounded-2xl border border-gray-300 bg-gray-50 px-4 py-2.5 text-sm focus:border-blue-400 focus:outline-none focus:bg-white transition-colors"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-40 hover:bg-blue-700 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}
