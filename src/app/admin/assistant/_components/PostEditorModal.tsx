"use client";

import { useEffect, useRef, useState } from "react";
import { X, Trash2, Plus, Loader2, Check, AlertCircle, Music, VolumeX } from "lucide-react";
import { useAutoSavePost } from "@/hooks/useAutoSavePost";
import { uploadPostMedia } from "@/lib/client/uploadPostMedia";
import { AudioPicker } from "@/app/admin/_shared/AudioPicker";
import { SyncedAudioVideo } from "@/app/admin/_shared/SyncedAudioVideo";

interface AudioTrackRef {
  id: string;
  title: string;
  url?: string | null;
}

interface MediaItem {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
  audioTrack?: AudioTrackRef | null;
}

interface PostEditorModalProps {
  postId: string;
  onClose: () => void;
  onSaved?: (patch: { body?: string; thumbUrl?: string | null }) => void;
}

export function PostEditorModal({ postId, onClose, onSaved }: PostEditorModalProps) {
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialBodyRef = useRef<string>("");
  const { save, status } = useAutoSavePost(postId, 600);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/posts/${postId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const fetchedBody = data.body ?? "";
        setBody(fetchedBody);
        initialBodyRef.current = fetchedBody;
        const items: MediaItem[] = (data.media ?? []).map(
          (m: {
            id: string;
            mimeType: string;
            url: string | null;
            hasAudio?: boolean | null;
            audioTrack?: AudioTrackRef | null;
          }) => ({
            id: m.id,
            mimeType: m.mimeType,
            url: m.url,
            hasAudio: m.hasAudio ?? null,
            audioTrack: m.audioTrack ?? null,
          }),
        );
        setMedia(items);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 360)}px`;
  }, [body]);

  // Lock background scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") handleClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleBodyChange(next: string) {
    setBody(next);
    save({ body: next });
  }

  async function handleDelete(mediaId: string) {
    setUploadError("");
    const res = await fetch(`/api/posts/${postId}/media/${mediaId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMedia((prev) => prev.filter((m) => m.id !== mediaId));
    } else {
      setUploadError("Failed to delete media. Please try again.");
    }
  }

  async function handleSetAudio(mediaId: string, audioTrackId: string | null) {
    setUploadError("");
    const res = await fetch(`/api/posts/${postId}/media/${mediaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audioTrackId }),
    });
    if (res.ok) {
      const updated = await res.json();
      setMedia((prev) =>
        prev.map((m) =>
          m.id === mediaId
            ? {
                ...m,
                url: updated.url ?? m.url,
                hasAudio: updated.hasAudio ?? m.hasAudio,
                audioTrack: updated.audioTrack ?? null,
              }
            : m,
        ),
      );
    } else {
      setUploadError("Failed to update audio. Please try again.");
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const newMedia = await uploadPostMedia(postId, file);
          const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
          setMedia((prev) => [
            ...prev,
            {
              id: newMedia.id,
              mimeType: newMedia.mimeType,
              url: newMedia.url ?? previewUrl,
            },
          ]);
        } catch {
          setUploadError("Failed to upload file. Please try again.");
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function pickFirstImageThumb(items: MediaItem[]): string | null {
    const img = items.find((m) => m.mimeType.startsWith("image/"));
    return img?.url ?? items[0]?.url ?? null;
  }

  function handleClose() {
    const trimmedNow = body;
    const changed = trimmedNow !== initialBodyRef.current;
    onSaved?.({
      ...(changed ? { body: trimmedNow } : {}),
      thumbUrl: pickFirstImageThumb(media),
    });
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-3 py-6"
      onClick={handleClose}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="relative flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-semibold text-[#0d0d0d]">Edit post</h2>
          <div className="flex items-center gap-2">
            <SaveIndicator status={status} />
            <button
              type="button"
              onClick={handleClose}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[#8e8ea0] hover:bg-gray-100 hover:text-[#0d0d0d]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-sm text-[#8e8ea0]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => handleBodyChange(e.target.value)}
                placeholder="Caption…"
                rows={4}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[15px] leading-snug text-[#0d0d0d] placeholder-[#8e8ea0] focus:border-gray-400 focus:outline-none"
              />

              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-[#8e8ea0]">
                    Media
                  </span>
                  {uploading && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#8e8ea0]">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Uploading…
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {media.map((m) => (
                    <MediaTile
                      key={m.id}
                      item={m}
                      onDelete={() => handleDelete(m.id)}
                      onSetAudio={(tid) => handleSetAudio(m.id, tid)}
                    />
                  ))}

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-[#8e8ea0] hover:border-gray-300 hover:bg-gray-50 hover:text-[#0d0d0d] transition-colors"
                    aria-label="Add media"
                  >
                    <Plus className="h-6 w-6" strokeWidth={1.5} />
                  </button>
                </div>

                {uploadError && (
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                    {uploadError}
                  </div>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/mp4,video/quicktime"
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: "idle" | "saving" | "saved" | "error" }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[#8e8ea0]">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <Check className="h-3 w-3" />
        Saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-red-600">
      <AlertCircle className="h-3 w-3" />
      Error
    </span>
  );
}

function MediaTile({
  item,
  onDelete,
  onSetAudio,
}: {
  item: MediaItem;
  onDelete: () => void;
  onSetAudio: (audioTrackId: string | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isVideo = item.mimeType.startsWith("video/");
  const isSilentVideo = isVideo && item.hasAudio === false;

  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-gray-100">
      {item.url ? (
        isVideo ? (
          item.audioTrack?.url ? (
            <SyncedAudioVideo
              key={item.audioTrack.id}
              videoSrc={item.url}
              audioSrc={item.audioTrack.url}
              className="h-full w-full object-cover"
              controls
            />
          ) : (
            <video
              key="no-audio"
              src={item.url}
              muted
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-cover"
            />
          )
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt="" className="h-full w-full object-cover" />
        )
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-[#8e8ea0]">
          (no preview)
        </div>
      )}

      {isSilentVideo && !item.audioTrack && (
        <div
          className="absolute bottom-1 left-1 rounded-full bg-gray-900/70 p-0.5 backdrop-blur-sm"
          title="Silent video — no audio track"
        >
          <VolumeX className="h-3 w-3 text-white" />
        </div>
      )}
      {isVideo && item.audioTrack && (
        <div
          className="absolute bottom-1 left-1 rounded-full bg-purple-600/70 p-0.5 backdrop-blur-sm"
          title={`Music: ${item.audioTrack.title}`}
        >
          <Music className="h-3 w-3 text-white" />
        </div>
      )}
      {isVideo && (
        <div className="absolute bottom-1 right-1">
          <AudioPicker
            currentTrack={item.audioTrack ?? null}
            onSetAudio={onSetAudio}
          />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (confirming) onDelete();
          else setConfirming(true);
        }}
        className={`absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full backdrop-blur-sm transition-colors ${
          confirming
            ? "bg-red-600 text-white shadow-lg ring-2 ring-red-300/60"
            : "bg-black/55 text-white opacity-0 group-hover:opacity-100"
        }`}
        aria-label={confirming ? "Confirm delete" : "Delete media"}
        title={confirming ? "Tap again to confirm" : "Delete"}
      >
        {confirming ? <Trash2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
