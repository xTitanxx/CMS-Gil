"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Sparkles, Check, X, Copy, ArrowUp, SquarePen, Plus, ExternalLink, Pencil, CalendarDays, Menu } from "lucide-react";
import { PostEditorModal } from "./PostEditorModal";
import { ProposalCard, type ProposalData } from "./ProposalCard";

const TOOL_LABELS: Record<string, string> = {
  recommend_posts: "Finding best posts",
  search_archive: "Searching archive",
  get_post: "Loading post",
  list_scheduled: "Checking schedule",
  list_planner_slots: "Checking planner",
  propose_to_planner: "Adding to planner",
  remove_planner_slot: "Removing from planner",
  approve_planner_slot: "Approving slot",
  swap_planner_slot: "Swapping post",
  clear_planner: "Clearing planner",
  schedule_planner: "Scheduling posts",
  unschedule: "Cancelling publish",
  update_post: "Updating post",
  rate_post: "Rating post",
  archive_post: "Archiving post",
  publish_now: "Publishing",
  analyze_captions: "Analyzing captions",
  caption_job_status: "Checking job status",
  save_memory: "Remembering",
  delete_memory: "Forgetting",
  list_memories: "Checking memories",
};

// Tools whose chips are hidden (planner panel / passive actions provide feedback)
const SILENT_TOOLS = new Set([
  "propose_to_planner", "remove_planner_slot", "approve_planner_slot",
  "swap_planner_slot", "clear_planner", "schedule_planner",
  "save_memory", "delete_memory",
]);

// Tools that modify planner state — trigger planner panel refresh on success.
// propose_to_planner is intentionally NOT here: it returns a proposal card; the
// V button on the card is what mutates (and triggers refresh from there).
const PLANNER_TOOLS = new Set([
  "remove_planner_slot", "approve_planner_slot",
  "swap_planner_slot", "clear_planner", "schedule_planner",
]);

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
  reasons?: string[];
  platformUrl?: string | null;
}

function reasonBadgeStyle(reason: string): string {
  if (/★/.test(reason)) return "bg-amber-50 text-amber-600";
  if (/evergreen/i.test(reason)) return "bg-emerald-50 text-emerald-600";
  if (/season/i.test(reason)) return "bg-teal-50 text-teal-600";
  if (/rarely|never/i.test(reason)) return "bg-purple-50 text-purple-600";
  if (/tag|keyword/i.test(reason)) return "bg-blue-50 text-blue-600";
  return "bg-gray-100 text-gray-500";
}

// Separate regexes: one for testing (no /g), one for matching (with /g)
const POST_REF_TEST = /\[post:([a-zA-Z0-9_-]+)\]/;
const POST_REF_RE = /\[post:([a-zA-Z0-9_-]+)\]/g;

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={`text-[#8e8ea0] hover:text-[#0d0d0d] transition-colors ${className ?? ""}`}
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  );
}

function InlinePostRef({
  post: initialPost,
  id,
  onFetched,
  onEdit,
}: {
  post: CachedPost | undefined;
  id: string;
  onFetched?: (post: CachedPost) => void;
  onEdit?: (postId: string) => void;
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
          platformUrl: data.platformUrl ?? null,
        };
        setPost(fetched);
        onFetched?.(fetched);
      })
      .catch(() => {});
  }, [id, post?.body, onFetched]);

  const href = `/admin/posts/${id}?from=assistant`;
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
      className="group/card relative my-2 block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md hover:border-gray-300"
    >
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(id);
            }}
            className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm text-[#0d0d0d] hover:text-black transition-colors"
            aria-label="Edit post"
            title="Edit post"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {post.platformUrl && (
          <a
            href={post.platformUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm text-blue-600 hover:text-blue-700 transition-colors"
            aria-label="View original post"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        <CopyButton
          text={post.body ?? ""}
          className="rounded-md bg-white/80 backdrop-blur-sm p-1.5 opacity-70 hover:opacity-100 shadow-sm"
        />
      </div>
      {post.thumbUrl && (
        <div className="relative h-32 w-full overflow-hidden bg-gray-100">
          {isVideo ? (
            <video
              src={`${post.thumbUrl}#t=0.1`}
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
      <div className="px-3 py-2">
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
        {post.reasons && post.reasons.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {post.reasons.map((r, i) => (
              <span key={i} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reasonBadgeStyle(r)}`}>
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
  );
}

function renderTextWithRefs(
  text: string,
  cache: Map<string, CachedPost>,
  onPostFetched?: (post: CachedPost) => void,
  onEdit?: (postId: string) => void,
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
        onEdit={onEdit}
      />,
    );
    last = start + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

interface ThreadViewProps {
  onPlanProposed?: () => void;
  onOpenPlanner?: () => void;
}

export function ThreadView({ onPlanProposed, onOpenPlanner }: ThreadViewProps) {
  const [messages, setMessages] = useState<UiMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [postCache, setPostCache] = useState<Map<string, CachedPost>>(new Map());
  const [proposalsByToolUseId, setProposalsByToolUseId] = useState<Map<string, ProposalData>>(new Map());
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Maps toolUseId → tool name so we can identify planner-related results
  const toolUseNamesRef = useRef<Map<string, string>>(new Map());


  function seedCacheFromToolResult(
    result: { ok: boolean; data?: unknown },
    toolUseId?: string,
  ) {
    if (!result.ok) return;
    const data = result.data as unknown;
    const entries: CachedPost[] = [];

    // Proposal payload: store in proposalsByToolUseId + seed post into cache
    if (
      data &&
      typeof data === "object" &&
      (data as { kind?: string }).kind === "proposal"
    ) {
      const proposal = data as ProposalData;
      if (toolUseId) {
        setProposalsByToolUseId((prev) => {
          const next = new Map(prev);
          next.set(toolUseId, proposal);
          return next;
        });
      }
      const p = proposal.post;
      entries.push({
        postId: p.id,
        body: p.body,
        tags: p.tags,
        stars: p.rating ?? null,
        lifecycle: p.lifecycle ?? null,
        thumbUrl: p.thumbUrl ?? null,
        platformUrl: p.platformUrl ?? null,
      });
    } else if (Array.isArray(data)) {
      for (const raw of data as Record<string, unknown>[]) {
        if (!raw?.postId) continue;
        const item = raw as unknown as CachedPost;
        // Normalize matchReasons (search) to reasons (recommend)
        if (!item.reasons && Array.isArray(raw.matchReasons)) {
          item.reasons = raw.matchReasons as string[];
        }
        entries.push(item);
      }
    } else if (data && typeof data === "object" && "id" in data) {
      const p = data as { id: string; body?: string; tags?: string[]; rating?: { stars?: number } | null; lifecycle?: string; media?: { mimeType?: string; url?: string; storageKey?: string }[] };
      // Extract thumbnail: prefer first image media URL, fall back to first media
      const imgMedia = p.media?.find((m) => m.mimeType?.startsWith("image/"));
      const firstMedia = p.media?.[0];
      const thumb = imgMedia?.url ?? firstMedia?.url ?? null;
      entries.push({
        postId: p.id,
        body: p.body,
        tags: p.tags,
        stars: p.rating?.stars ?? null,
        lifecycle: p.lifecycle ?? null,
        thumbUrl: thumb,
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
              const tu = b as unknown as { id: string; name: string; input: Record<string, unknown> };
              toolUseNamesRef.current.set(tu.id, tu.name);
              rehydrated.push({
                role: "assistant",
                kind: "tool_use",
                ...tu,
              });
            } else if (b.kind === "tool_result") {
              const tr = b as unknown as { toolUseId: string; result: { ok: boolean; data?: unknown; error?: string } };
              rehydrated.push({
                role: "assistant",
                kind: "tool_result",
                ...tr,
              });
              seedCacheFromToolResult(tr.result, tr.toolUseId);
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
    // Reset textarea height after clearing
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStreaming(true);

    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message: text }),
    });
    if (!res.ok || !res.body) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = await res.json();
        if (body?.error) detail = body.error;
      } catch { /* no JSON body */ }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", kind: "text", text: `Something went wrong (${detail}). Please try again.` },
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
            seedCacheFromToolResult(evt.result, evt.toolUseId);
            if (evt.result.ok && PLANNER_TOOLS.has(toolUseNamesRef.current.get(evt.toolUseId) ?? "")) {
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

  // Pre-compute tool_use groups: consecutive same-name tool calls collapse into one chip
  const toolGroups = useMemo(() => {
    const hidden = new Set<string>(); // tool_use IDs to skip rendering
    const leaders = new Map<string, { ids: string[] }>(); // first ID → all IDs in group

    const toolUses = messages
      .map((m, i) => (m.kind === "tool_use" ? { ...m, idx: i } : null))
      .filter(Boolean) as (Extract<UiMsg, { kind: "tool_use" }> & { idx: number })[];

    let i = 0;
    while (i < toolUses.length) {
      const start = toolUses[i];
      const ids = [start.id];
      let j = i + 1;
      // Group consecutive (by original index) tool_uses with the same name
      while (j < toolUses.length && toolUses[j].name === start.name && toolUses[j].idx === toolUses[j - 1].idx + 1) {
        ids.push(toolUses[j].id);
        hidden.add(toolUses[j].id);
        j++;
      }
      if (ids.length > 1) {
        leaders.set(start.id, { ids });
      }
      i = j;
    }
    return { hidden, leaders };
  }, [messages]);

  const handlePostFetched = useCallback((fetched: CachedPost) => {
    setPostCache((prev) => {
      const next = new Map(prev);
      next.set(fetched.postId, { ...prev.get(fetched.postId), ...fetched });
      return next;
    });
  }, []);

  const handleEditPost = useCallback((postId: string) => {
    setEditingPostId(postId);
  }, []);

  const handleEditorSaved = useCallback(
    (postId: string, patch: { body?: string; thumbUrl?: string | null }) => {
      setPostCache((prev) => {
        const existing = prev.get(postId);
        if (!existing && !patch.body && patch.thumbUrl == null) return prev;
        const next = new Map(prev);
        next.set(postId, {
          ...existing,
          postId,
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.thumbUrl !== undefined ? { thumbUrl: patch.thumbUrl } : {}),
        });
        return next;
      });
    },
    [],
  );

  const handleProposalApprove = useCallback(
    async (proposal: ProposalData) => {
      const res = await fetch("/api/planner/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId: proposal.postId,
          day: proposal.day,
          platforms: proposal.platforms,
          reasoning: proposal.reasoning,
        }),
      });
      if (!res.ok) throw new Error(`propose failed: ${res.status}`);
      onPlanProposed?.();
    },
    [onPlanProposed],
  );

  function renderMsg(m: UiMsg, key: number) {
    if (m.kind === "text") {
      if (m.role === "user") {
        return (
          <div key={key} className="flex justify-end">
            <div className="max-w-[80%] rounded-3xl rounded-br-md px-4 py-3 text-xl leading-normal whitespace-pre-wrap bg-[#f4f4f4] text-[#0d0d0d]">
              {m.text}
            </div>
          </div>
        );
      }
      return (
        <div key={key} className="flex items-start gap-2 justify-start">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white mt-0.5">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 max-w-[85%] text-xl leading-normal whitespace-pre-wrap text-[#0d0d0d]">
            {renderTextWithRefs(m.text, postCache, handlePostFetched, handleEditPost)}
            <div className="mt-2 flex items-center gap-3">
              <CopyButton text={m.text.replace(/\[post:[a-zA-Z0-9_-]+\]/g, "").trim()} />
            </div>
          </div>
        </div>
      );
    }
    if (m.kind === "tool_use") {
      if (SILENT_TOOLS.has(m.name)) return null;

      // Check if this tool_use ID is part of a group and not the leader
      if (toolGroups.hidden.has(m.id)) return null;

      const group = toolGroups.leaders.get(m.id);
      const count = group ? group.ids.length : 1;
      const groupIds = group ? group.ids : [m.id];

      // Check results for all IDs in the group
      const doneCount = groupIds.filter((id) =>
        messages.some((msg) => msg.kind === "tool_result" && msg.toolUseId === id),
      ).length;
      const errorCount = groupIds.filter((id) =>
        messages.some(
          (msg) => msg.kind === "tool_result" && msg.toolUseId === id && !msg.result.ok,
        ),
      ).length;
      // If streaming is done and some results never arrived, treat as done
      const allDone = doneCount === groupIds.length || !streaming;
      const anyError = errorCount > 0 || (!streaming && doneCount < groupIds.length);

      const label = TOOL_LABELS[m.name] ?? m.name;
      const countLabel = count > 1 ? ` (${allDone ? count : `${doneCount}/${count}`})` : "";

      return (
        <div key={key} className="pl-9 flex items-center gap-1.5 py-0.5">
          {allDone ? (
            anyError ? (
              <X className="h-3 w-3 text-red-400 flex-shrink-0" />
            ) : (
              <Check className="h-3 w-3 text-emerald-500 flex-shrink-0" />
            )
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-[#8e8ea0] flex-shrink-0" />
          )}
          <span
            className={`text-xs ${
              allDone
                ? anyError
                  ? "text-red-400"
                  : "text-gray-400"
                : "text-[#8e8ea0]"
            }`}
          >
            {label}{countLabel}{allDone ? "" : "…"}
          </span>
          {anyError && (
            <span className="text-xs text-red-400">
              — {doneCount < groupIds.length ? `${groupIds.length - doneCount} timed out` : `${errorCount} failed`}
            </span>
          )}
        </div>
      );
    }
    if (m.kind === "tool_result") {
      const proposal = proposalsByToolUseId.get(m.toolUseId);
      if (proposal) {
        return (
          <div key={key} className="pl-9">
            <ProposalCard proposal={proposal} onApprove={handleProposalApprove} />
          </div>
        );
      }
      // Other tool_result rendering is handled by the tool_use chip above.
      return null;
    }
    return null;
  }

  return (
    <div className="relative h-full bg-white">
      {/* Floating mobile burger (top-left) — assistant has no MobilePageHeader */}
      <div
        className="absolute left-2 z-30 md:hidden"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        <button
          onClick={() => window.dispatchEvent(new Event("open-sidebar"))}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/40 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 active:bg-white/70 touch-manipulation"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Floating action buttons (top-right): Planner + New chat */}
      <div
        className="absolute right-2 z-30 flex items-center gap-1.5"
        style={{ top: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        {onOpenPlanner && (
          <button
            onClick={() => onOpenPlanner()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/40 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 hover:bg-white/70 active:bg-white/80"
            aria-label="Open planner"
            title="Planner"
          >
            <CalendarDays className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
        <button
          onClick={async () => {
            if (messages.length === 0) return;
            await fetch("/api/assistant/thread", { method: "DELETE" });
            setMessages([]);
            setConversationId(null);
            toolUseNamesRef.current.clear();
            setProposalsByToolUseId(new Map());
          }}
          disabled={streaming || messages.length === 0}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/40 text-[#0d0d0d] shadow-[0_2px_8px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/30 hover:bg-white/70 active:bg-white/80 disabled:opacity-30"
          aria-label="New chat"
          title="New chat"
        >
          <SquarePen className="h-5 w-5" strokeWidth={1.75} />
        </button>
      </div>

      {/* Messages — full-height scroll, padding at top to clear floating buttons,
          padding at bottom to clear floating composer. */}
      <div className="absolute inset-0 overflow-y-auto px-3 pb-32 pt-[max(calc(env(safe-area-inset-top,0px)+3.5rem),4rem)] md:px-4 md:pt-14">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-[#0d0d0d] text-white">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="text-base font-medium text-[#0d0d0d]">How can I help?</p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-[#e5e5e5] bg-white px-4 py-2 text-sm text-[#0d0d0d] hover:bg-[#f4f4f4] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => renderMsg(m, i))}

          {streaming && (() => {
            // Find the last tool_use without a matching result to show active tool
            const lastToolUse = [...messages].reverse().find(
              (msg): msg is Extract<UiMsg, { kind: "tool_use" }> => msg.kind === "tool_use",
            );
            const hasResult = lastToolUse && messages.some(
              (msg) => msg.kind === "tool_result" && msg.toolUseId === lastToolUse.id,
            );
            const activeLabel = lastToolUse && !hasResult
              ? TOOL_LABELS[lastToolUse.name] ?? lastToolUse.name
              : null;

            return (
              <div className="flex items-start gap-2 justify-start">
                <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-2 py-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#8e8ea0]" />
                  <span className="text-sm text-[#8e8ea0]">
                    {activeLabel ? `${activeLabel}...` : "Thinking..."}
                  </span>
                </div>
              </div>
            );
          })()}
          <div ref={bottomRef} />
        </div>
      </div>


      {/* Floating composer — sits above the scroll area, text flows underneath. */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 md:px-4"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 12px)" }}
      >
        <div className="pointer-events-auto mx-auto w-full max-w-4xl">
          <div className="flex items-center rounded-3xl border border-black/5 bg-white/70 py-1 pl-1.5 pr-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.08)] backdrop-blur-xl supports-[backdrop-filter]:bg-white/60">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[#8e8ea0] transition-colors active:bg-black/10"
              aria-label="Attach"
            >
              <Plus className="h-5 w-5" strokeWidth={2} />
            </button>
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
              enterKeyHint="send"
              placeholder="Ask Assistant"
              rows={1}
              className="flex-1 resize-none self-center bg-transparent px-1.5 py-2 text-lg leading-5 text-[#0d0d0d] placeholder-[#8e8ea0] focus:outline-none"
              style={{ height: "auto", maxHeight: "120px", overflow: "auto" }}
            />
            {input.trim() ? (
              <button
                onClick={() => {
                  const v = input.trim();
                  if (v && !streaming) send(v);
                }}
                disabled={streaming}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0d0d0d] text-white disabled:opacity-40 transition-colors"
                aria-label="Send"
              >
                <ArrowUp className="h-5 w-5" />
              </button>
            ) : (
              <div className="h-9 w-9 flex-shrink-0" />
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              // TODO: handle image attachment
              const file = e.target.files?.[0];
              if (file) {
                console.log("Selected file:", file.name);
              }
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {editingPostId && (
        <PostEditorModal
          postId={editingPostId}
          onClose={() => setEditingPostId(null)}
          onSaved={(patch) => handleEditorSaved(editingPostId, patch)}
        />
      )}
    </div>
  );
}
