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
  // Per-turn $ cost from the server's COST_TRAILER. Only displayed for admins.
  costUsd?: number;
}

const POST_MARKER_RE = /\[POST:([^\]]+)\]/g;
// Matches the cost trailer the server appends at end-of-stream:
//   "\n​__USAGE_USD:0.012345__"  (the ​ is a U+200B zero-width space)
// The leading "\n" + zero-width-space are optional in the strip pattern —
// the model occasionally parrots the bare "__USAGE_USD:X__" form into its
// own output, and we want to scrub those too.
const COST_TRAILER_CAPTURE_RE = /\n?​?__USAGE_USD:([0-9.]+)__/;
const COST_TRAILER_STRIP_RE = /\n?​?__USAGE_USD:[0-9.]+__/g;

function stripMarkers(text: string): string {
  return text
    .replace(POST_MARKER_RE, "")
    .replace(COST_TRAILER_STRIP_RE, "")
    .replace(/\n{3,}/g, "\n\n");
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
  pre: ({ children }: { children?: React.ReactNode }) => (
    <pre className="overflow-x-auto rounded bg-gray-100 px-3 py-2 text-xs mb-2 whitespace-pre-wrap">{children}</pre>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline break-all hover:text-blue-800"
    >
      {children}
    </a>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-bold mb-2">{children}</p>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-bold mb-1.5">{children}</p>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <p className="font-semibold mb-1">{children}</p>
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

const SUGGESTIONS = [
  "What has Gil written about breathwork?",
  "How does Gil deal with tough days?",
  "What has Gil shared about MS?",
  "What does Gil say about depression?",
];

function EmptyIntro({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-10 text-center">
      <div className="h-20 w-20 overflow-hidden rounded-full bg-gray-200 ring-4 ring-white shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/avatar.jpg" alt="" className="h-full w-full object-cover" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-gray-900">Talk to the Archivist</h2>
        <p className="text-sm text-gray-500 max-w-xs">
          Trained on Gil&rsquo;s archive. Ask anything &mdash; if it&rsquo;s in there, it&rsquo;ll dig it up.
        </p>
      </div>
      <div className="grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left text-sm text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function GilChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [, setMessagesLoaded] = useState(false);
  const [budgetRefreshKey, setBudgetRefreshKey] = useState(0);
  const [role, setRole] = useState<"admin" | "subscriber" | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);

  // Track whether user has scrolled up so we don't yank them back down.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = dist < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/conversation");
        if (!res.ok) return;
        const data = (await res.json()) as {
          messages: { role: "user" | "assistant"; content: string }[];
          role?: "admin" | "subscriber" | null;
        };
        if (!cancelled && data.role) setRole(data.role);
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

  function resetTextareaHeight() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming || inputDisabled) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    resetTextareaHeight();
    stickToBottomRef.current = true;
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

      // Extract per-turn cost from the trailer the server appended at end of
      // stream, then strip it (and any model-parrot copies) from the message
      // we keep in state — otherwise the next turn echoes it back to the API
      // and the model adopts the pattern as part of its output style.
      const costMatch = fullContent.match(COST_TRAILER_CAPTURE_RE);
      const costUsd = costMatch ? parseFloat(costMatch[1]) : null;
      const cleanedContent = fullContent
        .replace(COST_TRAILER_STRIP_RE, "")
        .trimEnd();
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last) return prev;
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: cleanedContent,
            ...(costUsd !== null ? { costUsd } : {}),
          },
        ];
      });

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

  return (
    <div className="relative h-full bg-gray-50">
      {/* Floating top header — Archivist identity */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="pointer-events-auto border-b border-gray-200 bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5">
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
            <div className="min-w-0">
              <h1 className="text-sm font-semibold text-gray-900 leading-tight">The Archivist</h1>
              <p className="text-xs text-gray-500 leading-tight">AI trained on Gil&apos;s posts &mdash; not the real Gil</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable message region — Assistant pattern: no h-full on inner div,
          generous pb that includes the iOS safe-area inset so the composer
          can never overlap the last message on any device. */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-auto px-3 md:px-4"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 4.25rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 9rem)",
        }}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {messages.length === 0 ? (
            <EmptyIntro onPick={(s) => { setInput(s); textareaRef.current?.focus(); }} />
          ) : (
            messages.map((msg, i) => (
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
                  <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words bg-blue-600 text-white rounded-br-sm shadow-sm">
                    {msg.content}
                  </div>
                ) : (
                  <div
                    className={`text-sm whitespace-pre-wrap break-words text-gray-800 ${
                      msg.posts && msg.posts.length > 0
                        ? "max-w-[88%]"
                        : "max-w-[80%] rounded-2xl px-4 py-2.5 bg-white border border-gray-200 rounded-bl-sm shadow-sm"
                    }`}
                  >
                    {msg.posts && msg.posts.length > 0 ? (
                      <div className="rounded-2xl px-4 py-2.5 bg-white border border-gray-200 rounded-bl-sm shadow-sm">
                        <MessageContent content={msg.content} posts={msg.posts} />
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
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Floating composer — glass pill matching Assistant chat, with the budget
          meter sitting as a thin caption above it. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 md:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
      >
        <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-1.5">
          <BudgetMeter refreshKey={budgetRefreshKey} />
          <div className="flex items-center rounded-3xl border border-black/5 bg-white/85 py-1 pl-1.5 pr-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/70">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask the Archivist…"
              rows={1}
              disabled={inputDisabled || streaming}
              name="virtual-gil-message"
              autoComplete="off"
              autoCorrect="on"
              autoCapitalize="sentences"
              spellCheck={true}
              inputMode="text"
              enterKeyHint="send"
              data-form-type="other"
              data-1p-ignore
              data-lpignore="true"
              aria-label="Message the Archivist"
              className="flex-1 resize-none self-center bg-transparent px-3 py-2 text-base leading-5 text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
              style={{ height: "auto", maxHeight: "120px", overflowY: "auto" }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming || inputDisabled}
              aria-label="Send"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow transition-colors hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 disabled:shadow-none"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
