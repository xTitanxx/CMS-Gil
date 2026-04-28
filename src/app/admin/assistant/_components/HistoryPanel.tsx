"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Trash2, X, MessageSquare, Pencil, Check } from "lucide-react";

interface ConversationRow {
  id: string;
  title: string | null;
  updatedAt: string;
  messageCount: number;
}

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
  currentConversationId: string | null;
  onSelect: (id: string) => void;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: now - then > 365 * 24 * 60 * 60 * 1000 ? "numeric" : undefined,
  });
}

export function HistoryPanel({
  open,
  onClose,
  currentConversationId,
  onSelect,
}: HistoryPanelProps) {
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/threads");
      if (!res.ok) {
        setRows([]);
        return;
      }
      const d = (await res.json()) as { conversations: ConversationRow[] };
      setRows(d.conversations);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (editingId) {
          setEditingId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, editingId]);

  useEffect(() => {
    if (editingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [editingId]);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setRows((prev) => prev?.filter((r) => r.id !== id) ?? prev);
    const res = await fetch(`/api/assistant/thread/${id}`, { method: "DELETE" });
    if (!res.ok) void refresh();
    if (id === currentConversationId) {
      // The active chat was just deleted — start fresh next message.
      // The parent ThreadView keeps showing the now-orphan messages until the
      // user sends a new one or picks another from history; close the panel
      // and let them decide.
    }
  }

  async function handleRenameSubmit(id: string) {
    const title = editValue.trim();
    if (!title) {
      setEditingId(null);
      return;
    }
    setRows((prev) =>
      prev?.map((r) => (r.id === id ? { ...r, title } : r)) ?? prev,
    );
    setEditingId(null);
    const res = await fetch(`/api/assistant/thread/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) void refresh();
  }

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      {/* Panel — full-screen on mobile, slide-in from right on desktop */}
      <div
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-white shadow-2xl md:w-[380px] md:border-l md:border-gray-200"
        role="dialog"
        aria-label="Chat history"
      >
        <div
          className="flex items-center justify-between border-b border-gray-100 px-4 py-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
        >
          <h2 className="text-sm font-semibold text-[#0d0d0d]">Chat history</h2>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#0d0d0d] hover:bg-gray-100 active:bg-gray-200"
            aria-label="Close history"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && rows === null && (
            <div className="flex items-center justify-center py-16 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}
          {rows && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center text-sm text-gray-500">
              <MessageSquare className="mb-3 h-8 w-8 text-gray-300" strokeWidth={1.5} />
              <p>No previous chats yet.</p>
            </div>
          )}
          {rows && rows.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => {
                const isActive = r.id === currentConversationId;
                const isEditing = r.id === editingId;
                return (
                  <li
                    key={r.id}
                    className={`group relative flex items-start gap-2 px-4 py-3 ${
                      isActive ? "bg-gray-50" : "hover:bg-gray-50"
                    } ${isEditing ? "" : "cursor-pointer"}`}
                    onClick={() => {
                      if (isEditing) return;
                      onSelect(r.id);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      {isEditing ? (
                        <input
                          ref={renameInputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleRenameSubmit(r.id);
                            }
                          }}
                          onBlur={() => void handleRenameSubmit(r.id)}
                          onClick={(e) => e.stopPropagation()}
                          maxLength={120}
                          className="w-full rounded border border-gray-300 bg-white px-2 py-1 text-sm text-[#0d0d0d] focus:border-[#0d0d0d] focus:outline-none"
                        />
                      ) : (
                        <p
                          className={`truncate text-sm ${
                            isActive ? "font-semibold text-[#0d0d0d]" : "font-medium text-[#0d0d0d]"
                          }`}
                        >
                          {r.title?.trim() || "Untitled chat"}
                        </p>
                      )}
                      <p className="mt-0.5 text-xs text-gray-500">
                        {formatRelative(r.updatedAt)} · {r.messageCount}{" "}
                        {r.messageCount === 1 ? "message" : "messages"}
                      </p>
                    </div>
                    {!isEditing && (
                      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditValue(r.title ?? "");
                            setEditingId(r.id);
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-[#0d0d0d]"
                          aria-label="Rename chat"
                          title="Rename"
                        >
                          <Pencil className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                        <button
                          onClick={(e) => void handleDelete(r.id, e)}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600"
                          aria-label="Delete chat"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                    {isEditing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRenameSubmit(r.id);
                        }}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-gray-500 hover:bg-gray-200 hover:text-[#0d0d0d]"
                        aria-label="Save rename"
                        title="Save"
                      >
                        <Check className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
