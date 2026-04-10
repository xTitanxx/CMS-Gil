"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import {
  X,
  Upload,
  Film,
  Check,
  AlertCircle,
  VolumeX,
  Calendar,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { ReanalyzeButton } from "./PostInteractions";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

const ACCEPTED_MIME_TYPES = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
};

export interface MediaItem {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
}

interface PostEditorProps {
  postId: string;
  initialBody: string;
  initialOriginalDate: Date;
  initialTags: string[];
  initialMedia: MediaItem[];
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDatePretty(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function PostEditor({
  postId,
  initialBody,
  initialOriginalDate,
  initialTags,
  initialMedia,
}: PostEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [date, setDate] = useState(() => toDatetimeLocal(new Date(initialOriginalDate)));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [media, setMedia] = useState<MediaItem[]>(initialMedia);
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [mediaError, setMediaError] = useState("");
  const [editingDate, setEditingDate] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [body]);

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        const res = await fetch(`/api/posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body,
            originalDate: new Date(date).toISOString(),
            tags,
          }),
        });
        setSaveStatus(res.ok ? "saved" : "error");
      } catch {
        setSaveStatus("error");
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [body, date, tags, postId]);

  async function deleteMedia(mediaId: string) {
    setMediaError("");
    const res = await fetch(`/api/posts/${postId}/media/${mediaId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setMedia((prev) => prev.filter((m) => m.id !== mediaId));
    } else {
      setMediaError("Failed to delete media. Please try again.");
    }
  }

  async function uploadFile(file: File) {
    try {
      let newMedia: MediaItem;
      if (file.size < DIRECT_UPLOAD_LIMIT) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/posts/${postId}/media`, {
          method: "POST",
          body: formData,
        });
        if (!res.ok) throw new Error(await res.text());
        newMedia = await res.json();
      } else {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob",
        });
        const res = await fetch(`/api/posts/${postId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl: blob.url,
            filename: file.name,
            mimeType: file.type,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        newMedia = await res.json();
      }
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      setMedia((prev) => [...prev, { ...newMedia, url: previewUrl }]);
    } catch {
      setMediaError("Failed to upload file. Please try again.");
    }
  }

  const onDrop = useCallback(
    (accepted: File[]) => {
      setMediaError("");
      accepted.forEach((file) => void uploadFile(file));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [postId]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    multiple: true,
    noClick: true,
  });

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed]);
    }
    setTagInput("");
  }

  const hasMedia = media.length > 0;
  const primaryMedia = media[0];
  const restMedia = media.slice(1);

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />

      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-blue-400 bg-blue-50/90">
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">Drop to upload</p>
          </div>
        </div>
      )}

      <article className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {/* Caption — above the media, Facebook-style */}
        <div className="px-5 pt-4">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write a caption…"
            rows={1}
            className="w-full resize-none overflow-hidden border-0 bg-transparent text-[15px] leading-relaxed text-gray-800 placeholder:text-gray-400 focus:outline-none"
          />
        </div>

        {/* Media hero */}
        {hasMedia ? (
          <div className="mt-3 bg-gray-50">
            <MediaHero
              media={primaryMedia}
              onDelete={() => deleteMedia(primaryMedia.id)}
            />
            {restMedia.length > 0 && (
              <div className="grid grid-cols-4 gap-1 p-1">
                {restMedia.map((m) => (
                  <MediaTile
                    key={m.id}
                    media={m}
                    onDelete={() => deleteMedia(m.id)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Tags */}
        <div className="px-5 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700"
              >
                {tag}
                <button
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="text-gray-400 hover:text-gray-700"
                  aria-label={`Remove tag ${tag}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              placeholder={tags.length === 0 ? "Add tags…" : "+ tag"}
              className="min-w-[4rem] rounded-full border border-dashed border-gray-300 bg-transparent px-2.5 py-1 text-xs focus:border-blue-400 focus:outline-none"
            />
            <ReanalyzeButton postId={postId} />
          </div>
        </div>

        {/* Metadata footer */}
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 px-5 py-2 text-[11px] text-gray-500">
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3 text-gray-400" />
            {editingDate ? (
              <input
                type="datetime-local"
                value={date}
                autoFocus
                onBlur={() => setEditingDate(false)}
                onChange={(e) => setDate(e.target.value)}
                className="rounded border border-gray-300 px-1 py-0.5 text-[11px] focus:border-blue-500 focus:outline-none"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingDate(true)}
                className="rounded px-1 py-0.5 text-gray-500 hover:bg-gray-100"
                title="Edit date"
              >
                {formatDatePretty(date) || "Set date"}
              </button>
            )}
          </div>
          <span className="flex items-center gap-1">
            {saveStatus === "saving" && "Saving…"}
            {saveStatus === "saved" && (
              <>
                <Check className="h-3 w-3 text-green-500" />
                Saved
              </>
            )}
            {saveStatus === "error" && (
              <>
                <AlertCircle className="h-3 w-3 text-red-500" />
                Error
              </>
            )}
          </span>
        </div>
      </article>

      {/* Upload hint below the card */}
      <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-200 px-3 py-1.5 text-[11px] text-gray-500">
        <div className="flex items-center gap-2">
          <Upload className="h-3 w-3 text-gray-400" />
          <span>Drag files onto the post or</span>
          <UploadButton onSelect={(files) => onDrop(Array.from(files))} />
        </div>
        {mediaError && <span className="text-red-600">{mediaError}</span>}
      </div>
    </div>
  );
}

function MediaHero({
  media,
  onDelete,
}: {
  media: MediaItem;
  onDelete: () => void;
}) {
  const isVideo = media.mimeType.startsWith("video");
  const isSilentVideo = isVideo && media.hasAudio === false;

  return (
    <div className="relative flex-1">
      {media.url ? (
        isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={media.url}
            controls
            playsInline
            className="mx-auto max-h-[50vh] w-full object-contain bg-black"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt=""
            className="mx-auto max-h-[50vh] w-full object-contain"
          />
        )
      ) : (
        <div className="flex aspect-video items-center justify-center bg-gray-100">
          <Film className="h-8 w-8 text-gray-400" />
        </div>
      )}
      {isSilentVideo && (
        <div
          className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white"
          title="No audio track"
        >
          <VolumeX className="h-3 w-3" />
          <span>silent</span>
        </div>
      )}
      <button
        onClick={onDelete}
        className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
        aria-label="Delete media"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MediaTile({
  media,
  onDelete,
}: {
  media: MediaItem;
  onDelete: () => void;
}) {
  const isVideo = media.mimeType.startsWith("video");
  const isSilentVideo = isVideo && media.hasAudio === false;

  return (
    <div className="relative aspect-square overflow-hidden rounded-md">
      {media.url ? (
        isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={media.url}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={media.url}
            alt=""
            className="h-full w-full object-cover"
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center bg-gray-100">
          <Film className="h-5 w-5 text-gray-400" />
        </div>
      )}
      {isSilentVideo && (
        <div className="absolute bottom-1 left-1 rounded-full bg-black/60 p-0.5">
          <VolumeX className="h-3 w-3 text-white" />
        </div>
      )}
      <button
        onClick={onDelete}
        className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
        aria-label="Delete media"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function UploadButton({
  onSelect,
}: {
  onSelect: (files: FileList) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="font-medium text-blue-600 hover:text-blue-800"
      >
        choose files
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={Object.keys(ACCEPTED_MIME_TYPES).join(",")}
        onChange={(e) => {
          if (e.target.files) onSelect(e.target.files);
          e.target.value = "";
        }}
        className="hidden"
      />
    </>
  );
}
