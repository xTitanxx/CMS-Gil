"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

interface ModerationComment {
  id: string;
  postId: string;
  body: string;
  status: "PUBLISHED" | "HIDDEN";
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  authorName: string;
  subscriberId: string;
  postBodyExcerpt: string;
}

interface Page {
  comments: ModerationComment[];
  nextCursor: string | null;
}

type Filter = "PUBLISHED" | "HIDDEN" | null;

interface Props {
  initial: Page;
  initialStatus: Filter;
}

export function CommentsModerationClient({ initial, initialStatus }: Props) {
  const [filter, setFilter] = useState<Filter>(initialStatus);
  const [items, setItems] = useState<ModerationComment[]>(initial.comments);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (status: Filter, cursorVal: string | null, append: boolean) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (cursorVal) params.set("cursor", cursorVal);
      const res = await fetch(`/api/admin/comments?${params}`);
      if (!res.ok) return;
      const data = (await res.json()) as Page;
      setItems((prev) => (append ? [...prev, ...data.comments] : data.comments));
      setCursor(data.nextCursor);
    },
    []
  );

  async function changeFilter(next: Filter) {
    setFilter(next);
    setLoading(true);
    try {
      await fetchPage(next, null, false);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      await fetchPage(filter, cursor, true);
    } finally {
      setLoading(false);
    }
  }

  async function hide(id: string) {
    if (busyId) return;
    if (!window.confirm("Hide this comment from public view?")) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/comments/${id}/hide`, { method: "POST" });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "HIDDEN", deletedAt: new Date().toISOString() } : c
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  async function restore(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/comments/${id}/restore`, { method: "POST" });
      if (!res.ok) return;
      setItems((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "PUBLISHED", deletedAt: null } : c
        )
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-gray-500">Filter:</span>
        {(
          [
            { label: "All", value: null },
            { label: "Published", value: "PUBLISHED" as const },
            { label: "Hidden", value: "HIDDEN" as const },
          ] as const
        ).map((opt) => (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => changeFilter(opt.value)}
            className={`rounded-md px-3 py-1 ${
              filter === opt.value
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          No comments match this filter.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <li
              key={c.id}
              className="rounded-lg border border-gray-200 bg-white p-3 text-sm"
            >
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-gray-900">{c.authorName}</span>
                  <span className="text-xs text-gray-500">
                    {new Date(c.createdAt).toLocaleString()}
                    {c.editedAt && " · edited"}
                  </span>
                  {c.status === "HIDDEN" && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                      Hidden
                    </span>
                  )}
                </div>
                <div className="flex gap-3 text-xs">
                  <Link
                    href={`/p/${c.postId}#comments`}
                    target="_blank"
                    className="text-gray-500 hover:underline"
                  >
                    View post ↗
                  </Link>
                  {c.status === "PUBLISHED" ? (
                    <button
                      type="button"
                      onClick={() => hide(c.id)}
                      disabled={busyId === c.id}
                      className="text-red-600 hover:underline disabled:opacity-50"
                    >
                      Hide
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => restore(c.id)}
                      disabled={busyId === c.id}
                      className="text-blue-600 hover:underline disabled:opacity-50"
                    >
                      Restore
                    </button>
                  )}
                </div>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-gray-800">
                {c.body}
              </p>
              <p className="mt-2 truncate text-xs text-gray-400">
                On: {c.postBodyExcerpt}
              </p>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
