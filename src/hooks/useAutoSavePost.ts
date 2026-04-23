"use client";

import { useRef, useCallback, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSavePost(postId: string, debounceMs = 800) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(
    (fields: Record<string, unknown>) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("saving");
      timerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/posts/${postId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(fields),
          });
          setStatus(res.ok ? "saved" : "error");
        } catch {
          setStatus("error");
        }
      }, debounceMs);
    },
    [postId, debounceMs],
  );

  return { save, status };
}
