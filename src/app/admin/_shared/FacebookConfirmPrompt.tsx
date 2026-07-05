"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";

/**
 * "Did it post to Facebook?" — the one step that can't be automated away:
 * the share sheet only confirms the user picked Facebook, not that they
 * completed posting inside it. Used both right after the compose page's
 * share hand-off and from ShareToFacebookButton on every post's own page.
 */
export function FacebookConfirmPrompt({
  postId,
  onResolved,
}: {
  postId: string;
  onResolved: (confirmed: boolean) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleYes() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "FACEBOOK", status: "PUBLISHED" }),
      });
      if (!res.ok) {
        setError("Couldn't save that — try again.");
        return;
      }
      onResolved(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm font-semibold text-blue-900">Did it post to Facebook?</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleYes()}
          disabled={submitting}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" strokeWidth={2.5} />
          )}
          Yes, it&apos;s live
        </button>
        <button
          type="button"
          onClick={() => onResolved(false)}
          disabled={submitting}
          className="flex-1 rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        >
          Not yet
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}
