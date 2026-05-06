"use client";

import Link from "next/link";
import { useState } from "react";

interface Comment {
  id: string;
  body: string;
  status: "PUBLISHED" | "HIDDEN";
  createdAt: string;
  editedAt: string | null;
  postId: string;
  postBodyExcerpt: string;
}

export function SubscriberCommentRow({ comment }: { comment: Comment }) {
  const [status, setStatus] = useState(comment.status);
  const [busy, setBusy] = useState(false);

  async function hide() {
    if (!confirm("Hide this comment from public view?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/comments/${comment.id}/hide`, {
        method: "POST",
      });
      if (res.ok) setStatus("HIDDEN");
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/comments/${comment.id}/restore`, {
        method: "POST",
      });
      if (res.ok) setStatus("PUBLISHED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="px-5 py-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-gray-500">
          {new Date(comment.createdAt).toLocaleString()}
          {comment.editedAt && " · edited"}
          {status === "HIDDEN" && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
              Hidden
            </span>
          )}
        </span>
        <div className="flex gap-3 text-xs">
          <Link
            href={`/p/${comment.postId}#comments`}
            target="_blank"
            className="text-gray-500 hover:underline"
          >
            View ↗
          </Link>
          {status === "PUBLISHED" ? (
            <button
              type="button"
              onClick={hide}
              disabled={busy}
              className="text-red-600 hover:underline disabled:opacity-50"
            >
              Hide
            </button>
          ) : (
            <button
              type="button"
              onClick={restore}
              disabled={busy}
              className="text-blue-600 hover:underline disabled:opacity-50"
            >
              Restore
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-words text-gray-800">
        {comment.body}
      </p>
      <p className="mt-1.5 truncate text-xs text-gray-400">
        On: {comment.postBodyExcerpt}
      </p>
    </li>
  );
}
