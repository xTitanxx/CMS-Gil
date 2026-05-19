"use client";

import { useCallback, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PostListShell } from "@/app/admin/_shared/PostListShell";
import { TriageBuckets } from "./TriageBuckets";
import { TriageCard, type TriagePost } from "./TriageCard";

interface Toast {
  id: string;
  message: string;
  savedPost: TriagePost;
}

export function TriageView() {
  const searchParams = useSearchParams();
  const bucket = searchParams.get("bucket") ?? undefined;

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const handleDismiss = useCallback(
    (postId: string, action: "mark-ready" | "archive" | "trash", savedPost: TriagePost) => {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(postId);
        return next;
      });
      if (action !== "trash") {
        const toastId = `${postId}-${Date.now()}`;
        const message = action === "mark-ready" ? "Marked ready" : "Archived";
        setToasts((prev) => [...prev, { id: toastId, message, savedPost }]);
        setTimeout(() => {
          setToasts((prev) => prev.filter((t) => t.id !== toastId));
        }, 5000);
      }
    },
    [],
  );

  function undoDismiss(toast: Toast) {
    setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.delete(toast.savedPost.id);
      return next;
    });
  }

  return (
    <div className="relative">
      <PostListShell<TriagePost>
        apiEndpoint="/api/triage"
        extraParams={{ bucket }}
        title="Needs fixes"
        itemNoun={{ singular: "post", plural: "posts" }}
        listClassName="columns-1 gap-4 sm:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid"
        beforeList={<TriageBuckets />}
        getPostId={(p) => p.id}
        onPostsChanged={() => {
          // New fetch → clear the hidden-id set so the fresh list is accurate.
          setHiddenIds(new Set());
        }}
        renderRow={(post) => {
          if (hiddenIds.has(post.id)) return null;
          return (
            <TriageCard
              post={post}
              onDismiss={(id, action) => handleDismiss(id, action, post)}
            />
          );
        }}
      />

      {toasts.length > 0 && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-lg"
            >
              <span>{t.message}</span>
              <button
                onClick={() => undoDismiss(t)}
                className="font-semibold text-blue-300 hover:text-blue-200"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
