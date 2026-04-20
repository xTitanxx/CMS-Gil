"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, RotateCcw } from "lucide-react";
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
  "Plan my week",
];

interface CachedPost {
  postId: string;
  body?: string;
  tags?: string[];
  stars?: number | null;
  lifecycle?: string | null;
  thumbUrl?: string | null;
}

// Separate regexes: one for testing (no /g), one for matching (with /g)
const POST_REF_TEST = /\[post:([a-zA-Z0-9_-]+)\]/;
const POST_REF_RE = /\[post:([a-zA-Z0-9_-]+)\]/g;

function InlinePostRef({
  post: initialPost,
  id,
  onFetched,
}: {
  post: CachedPost | undefined;
  id: string;
  onFetched?: (post: CachedPost) => void;
}) {
  const [post, setPost] = useState(initialPost);
  const fetchedRef = useRef(false);

  // Sync with prop updates (e.g. cache populated after initial render)
  useEffect(() => {
    if (initialPost?.body) setPost(initialPost);
  }, [initialPost]);

  // Fetch on-demand if not in cache
  useEffect(() => {
    if (post?.body || fetchedRef.current) return;
    fetchedRef.current = true;
    fetch(`/api/posts/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        // Use first image media URL as thumbnail, fall back to first media
        const imgMedia = data.media?.find((m: { mimeType: string }) => m.mimeType?.startsWith("image/"));
        const firstMedia = data.media?.[0];
        const thumb = imgMedia?.url ?? firstMedia?.url ?? null;
        const fetched: CachedPost = {
          postId: id,
          body: data.body,
          tags: data.tags,
          stars: data.rating?.stars ?? null,
          lifecycle: data.lifecycle,
          thumbUrl: thumb,
        };
        setPost(fetched);
        onFetched?.(fetched);
      })
      .catch(() => {});
  }, [id, post?.body, onFetched]);

  const href = `/admin/posts/${id}`;
  if (!post?.body) {
    return (
      <a
        href={href}
        className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
      >
        post:{id.slice(0, 6)}…
      </a>
    );
  }
  const body = post.body.replace(/\s+/g, " ").trim();
  const truncated = body.length > 120 ? body.slice(0, 120).trimEnd() + "…" : body;
  const isVideo = post.thumbUrl?.includes("/video/") || post.thumbUrl?.endsWith(".mp4") || post.thumbUrl?.endsWith(".mov");

  return (
    <a
      href={href}
      className="my-2 block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md hover:border-blue-300"
    >
      {post.thumbUrl && (
        <div className="relative aspect-video w-full overflow-hidden bg-gray-100">
          {isVideo ? (
            <video
              src={post.thumbUrl}
              muted
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={post.thumbUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      )}
      <div className="px-3 py-2.5">
        <p className="text-sm leading-snug text-gray-800 line-clamp-3">{truncated}</p>
        <div className="mt-1.5 flex items-center gap-2">
          {post.stars ? (
            <span className="text-xs text-amber-500">{"★".repeat(post.stars)}</span>
          ) : null}
          {post.lifecycle && post.lifecycle !== "UNKNOWN" ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 uppercase">{post.lifecycle}</span>
          ) : null}
          {post.tags && post.tags.length > 0 ? (
            <span className="truncate text-[11px] text-gray-400">{post.tags.slice(0, 3).join(", ")}</span>
          ) : null}
        </div>
      </div>
    </a>
  );
}

function renderTextWithRefs(
  text: string,
  cache: Map<string, CachedPost>,
  onPostFetched?: (post: CachedPost) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let keyN = 0;
  // Create a fresh regex each time to avoid lastIndex issues
  const re = /\[post:([a-zA-Z0-9_-]+)\]/g;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const id = match[1];
    out.push(
      <InlinePostRef
        key={`ref-${keyN++}`}
        post={cache.get(id)}
        id={id}
        onFetched={onPostFetched}
      />,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d.toISOString();
}

interface ThreadViewProps {
  onPlanProposed?: () => void;
}

export function ThreadView({ onPlanProposed }: ThreadViewProps) {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [pendingPlan, setPendingPlan] = useState<PlanProposal | null>(null);
  const [postCache, setPostCache] = useState<Map<string, CachedPost>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Maps toolUseId → tool name so we can identify propose_to_planner results
  const toolUseNamesRef = useRef<Map<string, string>>(new Map());

  function seedCacheFromToolResult(result: { ok: boolean; data?: unknown }) {
    if (!result.ok) return;
    const data = result.data as unknown;
    const entries: CachedPost[] = [];
    if (Array.isArray(data)) {
      for (const item of data as CachedPost[]) if (item?.postId) entries.push(item);
    } else if (data && typeof data === "object" && "id" in data) {
      const p = data as { id: string; body?: string; tags?: string[]; rating?: { stars?: number } | null; lifecycle?: string; media?: { storageKey?: string }[] };
      entries.push({
        postId: p.id,
        body: p.body,
        tags: p.tags,
        stars: p.rating?.stars ?? null,
        lifecycle: p.lifecycle ?? null,
      });
    }
    if (!entries.length) return;
    setPostCache((prev) => {
      const next = new Map(prev);
      for (const e of entries) {
        const existing = next.get(e.postId);
        next.set(e.postId, { ...existing, ...e });
      }
      return next;
    });
  }

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
              const tr = b as unknown as { toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };
              rehydrated.push({
                role: "assistant",
                kind: "tool_result",
                ...tr,
              });
              seedCacheFromToolResult(tr.result);
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
    if (!res.ok || !res.body) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", kind: "text", text: "Something went wrong. Please try again." },
      ]);
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
            toolUseNamesRef.current.set(evt.id, evt.name);
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
          } else if (evt.kind === "error") {
            setMessages((prev) => [
              ...prev,
              { role: "assistant", kind: "text", text: evt.message ?? "Something went wrong. Try again." },
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
            seedCacheFromToolResult(evt.result);
            // When a planner proposal succeeds, refresh the planner panel
            if (evt.result.ok && toolUseNamesRef.current.get(evt.toolUseId) === "propose_to_planner") {
              onPlanProposed?.();
            }
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

  const handlePostFetched = useCallback((fetched: CachedPost) => {
    setPostCache((prev) => {
      const next = new Map(prev);
      next.set(fetched.postId, { ...prev.get(fetched.postId), ...fetched });
      return next;
    });
  }, []);

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      const hasPostRefs = m.role === "assistant" && POST_REF_TEST.test(m.text);
      return (
        <div
          key={key}
          className={`flex items-end gap-2 ${
            m.role === "user" ? "justify-end" : "justify-start"
          }`}
        >
          {m.role === "assistant" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-white self-start mt-1">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
          )}
          {m.role === "user" ? (
            <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap bg-blue-600 text-white rounded-br-sm">
              {m.text}
            </div>
          ) : (
            <div
              className={`text-sm leading-relaxed whitespace-pre-wrap text-gray-800 ${
                hasPostRefs
                  ? "max-w-[85%]"
                  : "max-w-[80%] rounded-2xl px-4 py-2.5 border border-gray-200 bg-white shadow-sm rounded-bl-sm"
              }`}
            >
              {hasPostRefs ? (
                <div className="rounded-2xl px-4 py-2.5 border border-gray-200 bg-white shadow-sm rounded-bl-sm">
                  {renderTextWithRefs(m.text, postCache, handlePostFetched)}
                </div>
              ) : (
                renderTextWithRefs(m.text, postCache, handlePostFetched)
              )}
            </div>
          )}
        </div>
      );
    }
    // Tool use/result messages are hidden — the planner panel is the output surface.
    // Only show errors so the user knows if something broke.
    if (m.kind === "tool_use") return null;
    if (m.kind === "tool_result") {
      if (!m.result.ok) {
        return (
          <div key={key} className="pl-10 text-xs text-red-500">
            error: {m.result.error}
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
        {messages.length > 0 && (
          <button
            onClick={async () => {
              await fetch("/api/assistant/thread", { method: "DELETE" });
              setMessages([]);
              setConversationId(null);
              toolUseNamesRef.current.clear();
            }}
            disabled={streaming}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-500 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New chat
          </button>
        )}
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
