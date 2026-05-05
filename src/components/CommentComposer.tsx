"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { COMMENT_BODY_MAX } from "./comment-constants";
import type { CommentDTO } from "./CommentThread";

interface Props {
  postId: string;
  /** True when the viewer has a subscriber session. */
  signedIn: boolean;
  /** Subscriber's display name, or null if not yet set. Triggers the inline displayName prompt on first comment. */
  initialDisplayName: string | null;
  /** Subscriber's commentsDisabledAt (truthy → disabled state). */
  commentsDisabled: boolean;
  /** Callback to append the new comment into the thread. */
  onPosted: (c: CommentDTO) => void;
}

const SIGN_IN_HREF = (postId: string) =>
  `/welcome?next=${encodeURIComponent(`/p/${postId}#comments`)}`;

export function CommentComposer({
  postId,
  signedIn,
  initialDisplayName,
  commentsDisabled,
  onPosted,
}: Props) {
  const [body, setBody] = useState("");
  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [savedDisplayName, setSavedDisplayName] = useState(initialDisplayName);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  if (!signedIn) {
    return (
      <div className="border-t border-gray-200 bg-white p-4">
        <Link
          href={SIGN_IN_HREF(postId)}
          className="block w-full rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Sign in to comment
        </Link>
      </div>
    );
  }

  if (commentsDisabled) {
    return (
      <div className="border-t border-gray-200 bg-white p-4">
        <p className="rounded-md bg-gray-50 px-3 py-2 text-center text-xs text-gray-500">
          Commenting has been turned off for your account. Message Gil if you
          think this is a mistake.
        </p>
      </div>
    );
  }

  const needsDisplayName = !savedDisplayName;
  const trimmed = body.trim();
  const overLimit = trimmed.length > COMMENT_BODY_MAX;
  const showCounter = trimmed.length > 1800;
  const dnTrimmed = displayName.trim();
  const canSubmit =
    !posting &&
    trimmed.length > 0 &&
    !overLimit &&
    (!needsDisplayName || (dnTrimmed.length > 0 && dnTrimmed.length <= 50));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPosting(true);
    setError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: trimmed,
          ...(needsDisplayName ? { displayName: dnTrimmed } : {}),
        }),
      });
      if (res.status === 429) {
        setError("Too fast — wait a moment before posting again.");
        return;
      }
      if (res.status === 403) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === "comments_disabled"
            ? "Commenting has been turned off for your account."
            : "You're not allowed to post here."
        );
        return;
      }
      if (!res.ok) {
        setError("Couldn't post. Try again.");
        return;
      }
      const data = (await res.json()) as { comment: CommentDTO };
      onPosted(data.comment);
      setBody("");
      if (needsDisplayName) setSavedDisplayName(dnTrimmed);
      textareaRef.current?.focus();
    } catch {
      setError("Couldn't post. Try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={submit} className="border-t border-gray-200 bg-white p-4">
      {needsDisplayName && (
        <div className="mb-3">
          <label
            htmlFor="composer-display-name"
            className="mb-1 block text-xs font-semibold text-gray-700"
          >
            Pick a display name
          </label>
          <p className="mb-1.5 text-xs text-gray-500">
            This is what other readers will see. Choose something you&rsquo;re
            comfortable with — Gil already knows you by your real name.
          </p>
          <input
            id="composer-display-name"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Eitan A."
            maxLength={50}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Add a comment…"
        rows={3}
        className="w-full resize-none rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
      />

      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="text-xs">
          {error && <span className="text-red-600">{error}</span>}
          {!error && showCounter && (
            <span className={overLimit ? "text-red-600" : "text-gray-400"}>
              {trimmed.length} / {COMMENT_BODY_MAX}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {posting ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}
