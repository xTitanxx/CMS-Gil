"use client";

import { useCallback, useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";

export interface CommentDTO {
  id: string;
  postId: string;
  body: string;
  authorName: string;
  authorIsMine: boolean;
  createdAt: string;
  editedAt: string | null;
  status: "PUBLISHED" | "HIDDEN";
}

interface ListPage {
  comments: CommentDTO[];
  nextCursor: string | null;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

function renderBodyWithLinks(body: string) {
  const parts = body.split(URL_RE);
  return parts.map((part, i) =>
    URL_RE.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-blue-600 hover:underline"
      >
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

interface Props {
  postId: string;
  initial: ListPage;
  /** Used to update the list when the composer posts a new comment. */
  appendRef?: { current: ((c: CommentDTO) => void) | null };
}

export function CommentThread({ postId, initial, appendRef }: Props) {
  const [items, setItems] = useState<CommentDTO[]>(initial.comments);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const append = useCallback((c: CommentDTO) => {
    setItems((prev) => [...prev, c]);
  }, []);

  useEffect(() => {
    if (!appendRef) return;
    appendRef.current = append;
    return () => {
      if (appendRef.current === append) appendRef.current = null;
    };
  }, [appendRef, append]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/posts/${postId}/comments?cursor=${encodeURIComponent(cursor)}`
      );
      if (!res.ok) return;
      const page = (await res.json()) as ListPage;
      setItems((prev) => [...prev, ...page.comments]);
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  }, [cursor, loading, postId]);

  function startEdit(c: CommentDTO) {
    setEditingId(c.id);
    setEditDraft(c.body);
    setOpenMenu(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft("");
  }

  async function saveEdit(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: editDraft }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { comment: CommentDTO };
      setItems((prev) => prev.map((c) => (c.id === id ? data.comment : c)));
      setEditingId(null);
      setEditDraft("");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(id: string) {
    setOpenMenu(null);
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this comment?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/posts/${postId}/comments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) return;
      setItems((prev) => prev.filter((c) => c.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section id="comments" className="border-t border-gray-200 bg-gray-50 p-4">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">
        Comments {items.length > 0 ? `(${items.length})` : ""}
      </h2>

      {items.length === 0 && (
        <p className="text-xs text-gray-500">Be the first to comment.</p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((c) => (
          <li key={c.id} className="rounded-lg bg-white p-3 shadow-sm">
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-gray-900">
                  {c.authorName}
                </span>
                <span className="text-xs text-gray-500">
                  {formatRelative(c.createdAt)}
                  {c.editedAt && (
                    <>
                      {" · "}
                      <span title={`Edited ${new Date(c.editedAt).toLocaleString()}`}>
                        edited
                      </span>
                    </>
                  )}
                </span>
              </div>
              {c.authorIsMine && c.status === "PUBLISHED" && editingId !== c.id && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenMenu((cur) => (cur === c.id ? null : c.id))}
                    className="rounded p-1 text-gray-500 hover:bg-gray-100"
                    aria-label="Comment actions"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                  {openMenu === c.id && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-32 overflow-hidden rounded-md border border-gray-200 bg-white shadow-lg">
                      <button
                        type="button"
                        onClick={() => startEdit(c)}
                        className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-gray-50"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {editingId === c.id ? (
              <div className="mt-2">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                />
                <div className="mt-1 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="rounded px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => saveEdit(c.id)}
                    disabled={busyId === c.id || editDraft.trim().length === 0}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800">
                {c.status === "HIDDEN" ? (
                  <span className="italic text-gray-400">[deleted]</span>
                ) : (
                  renderBodyWithLinks(c.body)
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="mt-3 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
