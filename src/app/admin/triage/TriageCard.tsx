"use client";

import { useState, useRef, useCallback, useEffect, useId } from "react";
import {
  VolumeX,
  CheckCircle,
  Archive,
  Trash2,
  ExternalLink,
  AlertTriangle,
  FileX,
  Share2,
  Ban,
} from "lucide-react";
import { MediaReplaceDrop } from "./MediaReplaceDrop";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TriageMedia {
  id: string;
  mimeType: string;
  url: string | null;
  thumbnailUrl: string | null;
  hasAudio: boolean | null;
}

export interface TriagePost {
  id: string;
  body: string;
  originalDate: string;
  notReadyReasons: string[];
  media: TriageMedia[];
}

interface Props {
  post: TriagePost;
  onDismiss: (postId: string, action: "mark-ready" | "archive" | "trash") => void;
}

// ─── Reason display helpers ───────────────────────────────────────────────────

const REASON_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  "silent-video": {
    label: "Silent video",
    icon: <VolumeX className="h-3 w-3" />,
    color: "bg-amber-100 text-amber-700",
  },
  "unchecked-audio": {
    label: "Audio unchecked",
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "bg-yellow-100 text-yellow-700",
  },
  empty: {
    label: "Empty",
    icon: <FileX className="h-3 w-3" />,
    color: "bg-red-100 text-red-700",
  },
  "share-only": {
    label: "Share only",
    icon: <Share2 className="h-3 w-3" />,
    color: "bg-purple-100 text-purple-700",
  },
  "broken-media": {
    label: "Broken media",
    icon: <AlertTriangle className="h-3 w-3" />,
    color: "bg-red-100 text-red-700",
  },
  "dont-post": {
    label: "Don't post",
    icon: <Ban className="h-3 w-3" />,
    color: "bg-gray-100 text-gray-600",
  },
};

// ─── Swipe hook ───────────────────────────────────────────────────────────────

const SWIPE_THRESHOLD = 60; // px
const LONG_PRESS_MS = 600;

function useSwipe(
  onSwipeRight: () => void,
  onSwipeLeft: () => void,
  onLongPress: () => void
) {
  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [deltaX, setDeltaX] = useState(0);
  const dragging = useRef(false);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const t = e.touches[0];
      startX.current = t.clientX;
      startY.current = t.clientY;
      startTime.current = Date.now();
      dragging.current = false;
      longPressTimer.current = setTimeout(() => {
        if (!dragging.current) onLongPress();
      }, LONG_PRESS_MS);
    },
    [onLongPress]
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      dragging.current = true;
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      setDeltaX(dx);
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    const dx = deltaX;
    setDeltaX(0);
    if (dx > SWIPE_THRESHOLD) onSwipeRight();
    else if (dx < -SWIPE_THRESHOLD) onSwipeLeft();
  }, [deltaX, onSwipeRight, onSwipeLeft]);

  return { deltaX, onTouchStart, onTouchMove, onTouchEnd };
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function TriageCard({ post, onDismiss }: Props) {
  const [bodyDraft, setBodyDraft] = useState(post.body);
  const [savingBody, setSavingBody] = useState(false);
  const [bodySaved, setBodySaved] = useState(false);
  const [probingAudio, setProbingAudio] = useState(false);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [acting, setActing] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const modalHeadingRef = useRef<HTMLHeadingElement>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const dialogTitleId = useId();

  const primaryReason = post.notReadyReasons[0] ?? "";
  const firstMedia = post.media[0] ?? null;
  const firstVideo = post.media.find((m) => m.mimeType.startsWith("video")) ?? null;

  // ── Actions ──

  async function act(action: "mark-ready" | "archive" | "trash") {
    if (acting) return;
    setActing(true);
    try {
      if (action === "mark-ready") {
        await fetch(`/api/triage/${post.id}/mark-ready`, { method: "POST" });
      } else if (action === "archive") {
        await fetch(`/api/triage/${post.id}/archive`, { method: "POST" });
      } else {
        await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      }
      onDismiss(post.id, action);
    } catch {
      setActing(false);
    }
  }

  async function saveBody() {
    setSavingBody(true);
    try {
      await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: bodyDraft }),
      });
      setBodySaved(true);
      setTimeout(() => setBodySaved(false), 2000);
    } finally {
      setSavingBody(false);
    }
  }

  async function probeAudio() {
    if (!firstVideo || probingAudio) return;
    setProbingAudio(true);
    try {
      await fetch(`/api/media/${firstVideo.id}/probe-audio`, { method: "POST" });
      onDismiss(post.id, "mark-ready"); // re-evaluate readiness
    } finally {
      setProbingAudio(false);
    }
  }

  async function unmarkDontPost() {
    setActing(true);
    try {
      await fetch(`/api/triage/${post.id}/dont-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      });
      onDismiss(post.id, "mark-ready");
    } catch {
      setActing(false);
    }
  }

  // ── Swipe gestures ──

  const handleSwipeRight = useCallback(() => act("mark-ready"), [post.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleSwipeLeft = useCallback(() => act("archive"), [post.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const handleLongPress = useCallback(() => setConfirmTrash(true), []);

  const { deltaX, onTouchStart, onTouchMove, onTouchEnd } = useSwipe(
    handleSwipeRight,
    handleSwipeLeft,
    handleLongPress
  );

  // ── Keyboard alternatives to swipe ──
  // Right = mark ready, Left = archive, Delete/Backspace = open trash confirm.
  // Skip when focus is in an input/textarea/contenteditable so typing the
  // caption doesn't fire archive/ready.
  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (acting || confirmTrash) return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        void act("mark-ready");
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void act("archive");
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        setConfirmTrash(true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acting, confirmTrash, post.id]
  );

  // ── Modal focus trap + restore ──
  useEffect(() => {
    if (!confirmTrash) return;

    // Capture the trigger so we can restore focus on close.
    modalReturnFocusRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    // Move focus into the modal heading on open.
    requestAnimationFrame(() => {
      modalHeadingRef.current?.focus();
    });

    function getFocusable(): HTMLElement[] {
      const root = modalRef.current;
      if (!root) return [];
      const sel =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => !el.hasAttribute("aria-hidden")
      );
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setConfirmTrash(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        modalHeadingRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || active === modalHeadingRef.current || !modalRef.current?.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to the trigger when the modal closes.
      const ret = modalReturnFocusRef.current;
      if (ret && typeof ret.focus === "function") {
        // Defer so React commits the unmount first.
        requestAnimationFrame(() => ret.focus());
      }
      modalReturnFocusRef.current = null;
    };
  }, [confirmTrash]);

  const swipeStyle =
    deltaX !== 0
      ? {
          transform: `translateX(${deltaX}px)`,
          transition: "none",
          opacity: 1 - Math.min(Math.abs(deltaX) / 200, 0.4),
        }
      : { transform: "translateX(0)", transition: "transform 0.2s ease, opacity 0.2s ease" };

  // ── Thumb ──

  const thumbUrl = firstMedia?.thumbnailUrl ?? firstMedia?.url ?? null;
  const isVideo = firstMedia?.mimeType.startsWith("video") ?? false;
  const isSilent = isVideo && firstMedia?.hasAudio === false;

  // ── Primary fix ──

  function PrimaryFix() {
    if (primaryReason === "silent-video" || primaryReason === "broken-media") {
      const targetMedia =
        primaryReason === "broken-media"
          ? (firstMedia ?? null)
          : (firstVideo ?? null);
      if (!targetMedia) return null;
      return (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-gray-500">
            {primaryReason === "silent-video" ? "Replace with audio video" : "Replace broken media"}
          </p>
          <MediaReplaceDrop
            mediaId={targetMedia.id}
            onDone={() => onDismiss(post.id, "mark-ready")}
          />
        </div>
      );
    }

    if (primaryReason === "unchecked-audio") {
      return (
        <div className="mt-3">
          <button
            onClick={probeAudio}
            disabled={probingAudio}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-yellow-50 px-4 py-2 text-sm font-medium text-yellow-700 hover:bg-yellow-100 disabled:opacity-60"
          >
            {probingAudio ? "Checking…" : "Check audio status"}
          </button>
        </div>
      );
    }

    if (primaryReason === "empty" || primaryReason === "share-only") {
      return (
        <div className="mt-3">
          <textarea
            value={bodyDraft}
            onChange={(e) => setBodyDraft(e.target.value)}
            placeholder="Add a caption…"
            rows={3}
            className="w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none"
          />
          <button
            onClick={saveBody}
            disabled={savingBody || bodyDraft === post.body}
            className="mt-1.5 flex min-h-[44px] w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingBody ? "Saving…" : bodySaved ? "Saved!" : "Save caption"}
          </button>
        </div>
      );
    }

    if (primaryReason === "dont-post") {
      return (
        <div className="mt-3">
          <button
            onClick={unmarkDontPost}
            disabled={acting}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            <Ban className="h-4 w-4" />
            {acting ? "Removing…" : "Remove Don't-post flag"}
          </button>
        </div>
      );
    }

    return null;
  }

  return (
    <>
      {/* Confirm trash overlay */}
      {confirmTrash && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          ref={modalRef}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3
              id={dialogTitleId}
              ref={modalHeadingRef}
              tabIndex={-1}
              className="mb-2 text-base font-semibold text-gray-900 focus:outline-none"
            >
              Move to trash?
            </h3>
            <p className="mb-5 text-sm text-gray-500">This will delete the post permanently.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmTrash(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              <button
                onClick={() => { setConfirmTrash(false); void act("trash"); }}
                className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              >
                Trash it
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={cardRef}
        style={swipeStyle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onKeyDown={handleCardKeyDown}
        tabIndex={0}
        role="group"
        aria-label="Triage post — Right arrow marks ready, Left arrow archives, Delete moves to trash"
        className={`relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${acting ? "opacity-50 pointer-events-none" : ""}`}
      >
        {/* Swipe hint overlays */}
        {deltaX > 20 && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-16 items-center justify-center bg-green-400/20">
            <CheckCircle className="h-6 w-6 text-green-600" />
          </div>
        )}
        {deltaX < -20 && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-16 items-center justify-center bg-orange-400/20">
            <Archive className="h-6 w-6 text-orange-600" />
          </div>
        )}

        {/* Media preview — playable video or full-width image */}
        {firstMedia && (
          <div className="relative w-full overflow-hidden bg-black">
            {isVideo && firstMedia.url ? (
              <video
                src={firstMedia.url}
                poster={firstMedia.thumbnailUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="block max-h-[60vh] w-full bg-black"
              />
            ) : (
              thumbUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbUrl}
                  alt=""
                  className="block max-h-[60vh] w-full bg-black object-contain"
                />
              )
            )}
            {isSilent && (
              <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                <VolumeX className="h-3 w-3" />
                No audio
              </div>
            )}
            {post.media.length > 1 && (
              <div className="pointer-events-none absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
                +{post.media.length - 1} more
              </div>
            )}
          </div>
        )}

        {/* Header: reason chips + body + date */}
        <div className="p-4">
          {/* Reason chips */}
          <div className="mb-2 flex flex-wrap gap-1">
            {post.notReadyReasons.map((r) => {
              const meta = REASON_META[r];
              if (!meta) return null;
              return (
                <span
                  key={r}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.color}`}
                >
                  {meta.icon}
                  {meta.label}
                </span>
              );
            })}
          </div>

          {/* Body preview */}
          <p className="line-clamp-3 whitespace-pre-wrap text-sm text-gray-700">
            {post.body || <span className="italic text-gray-400">No caption</span>}
          </p>

          {/* Date + post id for reference */}
          <p className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
            <span>
              {new Date(post.originalDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <span className="font-mono opacity-70">{post.id.slice(-6)}</span>
          </p>
        </div>

        {/* Primary fix area */}
        <div className="px-4">
          <PrimaryFix />
        </div>

        {/* Secondary actions */}
        <div className="mt-3 flex items-center gap-1 border-t border-gray-100 px-4 py-3">
          <button
            onClick={() => act("mark-ready")}
            disabled={acting}
            title="Mark ready"
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-green-50 px-2 py-2 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
          >
            <CheckCircle className="h-4 w-4" />
            Ready
          </button>
          <button
            onClick={() => act("archive")}
            disabled={acting}
            title="Archive"
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-50 px-2 py-2 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
          >
            <Archive className="h-4 w-4" />
            Archive
          </button>
          <button
            onClick={() => setConfirmTrash(true)}
            disabled={acting}
            title="Trash"
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-red-50 px-2 py-2 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Trash
          </button>
          <a
            href={`/admin/posts/${post.id}`}
            target="_blank"
            rel="noreferrer"
            title="Open editor"
            className="flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-gray-50 px-2 py-2 text-xs font-medium text-gray-600 hover:bg-gray-100"
          >
            <ExternalLink className="h-4 w-4" />
            Edit
          </a>
        </div>
      </div>
    </>
  );
}
