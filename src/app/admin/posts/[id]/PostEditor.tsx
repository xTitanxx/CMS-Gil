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
  Music,
  Calendar,
  ExternalLink,
  Link as LinkIcon,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { ReanalyzeButton } from "./PostInteractions";
import { LifecycleChip } from "./LifecycleChip";

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

export interface AudioTrackRef {
  id: string;
  title: string;
}

export interface MediaItem {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
  audioTrack?: AudioTrackRef | null;
}

type Lifecycle = "EVERGREEN" | "EPHEMERAL" | "SEASONAL" | "UNKNOWN";
type Season = "SPRING" | "SUMMER" | "FALL" | "WINTER" | null;

interface PostEditorProps {
  postId: string;
  initialBody: string;
  initialOriginalDate: Date;
  initialTags: string[];
  initialMedia: MediaItem[];
  initialPostType: string;
  initialLifecycle: Lifecycle;
  initialSeason: Season;
  source: string;
  platformUrl: string | null;
  share: { url?: string; source?: string; name?: string } | null;
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
  initialPostType,
  initialLifecycle,
  initialSeason,
  source,
  platformUrl,
  share,
}: PostEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [postType, setPostType] = useState(initialPostType);
  const [date, setDate] = useState(() => toDatetimeLocal(new Date(initialOriginalDate)));
  const [tags, setTags] = useState<string[]>(initialTags);
  const [media, setMedia] = useState<MediaItem[]>(initialMedia);
  const [currentShare, setCurrentShare] = useState(share);
  const [currentPlatformUrl, setCurrentPlatformUrl] = useState(platformUrl ?? "");
  const [editingLink, setEditingLink] = useState(false);
  const [linkDraft, setLinkDraft] = useState(platformUrl ?? "");
  const [tagInput, setTagInput] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [mediaError, setMediaError] = useState("");
  const [editingDate, setEditingDate] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const CAPTION_CHAR_LIMIT = 280;
  const isLong = body.length > CAPTION_CHAR_LIMIT;

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

  async function setMediaAudio(mediaId: string, audioTrackId: string | null) {
    setMediaError("");
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
            ? { ...m, url: updated.url, audioTrack: updated.audioTrack }
            : m,
        ),
      );
    } else {
      setMediaError("Failed to update audio. Please try again.");
    }
  }

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
        {/* Header: date + source + FB link */}
        <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-2 text-[11px] text-gray-500">
          <div className="flex items-center gap-2">
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
            <span className="text-gray-300">·</span>
            <span className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
              {source}
            </span>
            {/* Post type selector */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Type</span>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                {(["POST", "REEL", "STORY"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={async () => {
                      setPostType(t);
                      await fetch(`/api/posts/${postId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ postType: t }),
                      });
                    }}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      postType === t
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {t === "POST" ? "Post" : t === "REEL" ? "Reel" : "Story"}
                  </button>
                ))}
              </div>
            </div>
            {editingLink ? (
              <span className="inline-flex items-center gap-1">
                <input
                  type="url"
                  autoFocus
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  placeholder="https://…"
                  className="w-56 rounded border border-gray-300 px-1 py-0.5 text-[11px] focus:border-blue-500 focus:outline-none"
                  onKeyDown={async (e) => {
                    if (e.key === "Escape") {
                      setLinkDraft(currentPlatformUrl);
                      setEditingLink(false);
                    }
                    if (e.key === "Enter") {
                      const val = linkDraft.trim();
                      setCurrentPlatformUrl(val);
                      setEditingLink(false);
                      await fetch(`/api/posts/${postId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ platformUrl: val || null }),
                      });
                    }
                  }}
                  onBlur={async () => {
                    const val = linkDraft.trim();
                    setCurrentPlatformUrl(val);
                    setEditingLink(false);
                    await fetch(`/api/posts/${postId}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ platformUrl: val || null }),
                    });
                  }}
                />
              </span>
            ) : currentPlatformUrl ? (
              <span className="inline-flex items-center gap-1">
                <a
                  href={currentPlatformUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-blue-600 hover:bg-blue-50"
                  title="Open the original post"
                >
                  View original
                  <ExternalLink className="h-3 w-3" />
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setLinkDraft(currentPlatformUrl);
                    setEditingLink(true);
                  }}
                  className="text-[10px] text-gray-400 hover:text-gray-600"
                >
                  edit
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setLinkDraft("");
                  setEditingLink(true);
                }}
                className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[10px] text-gray-500 hover:border-gray-400 hover:text-gray-700"
                title="Add original post link"
              >
                <LinkIcon className="h-3 w-3" />
                Add link
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

        {/* Caption — compact, FB-style with Read more */}
        <div className="px-5 pt-3">
          <div
            className={
              isLong && !expanded
                ? "max-h-[5.25rem] overflow-hidden"
                : undefined
            }
          >
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a caption…"
              rows={1}
              className="w-full resize-none overflow-hidden border-0 bg-transparent text-[13px] leading-snug text-gray-800 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-0.5 text-[12px] font-medium text-gray-500 hover:text-gray-700"
            >
              {expanded ? "See less" : "See more"}
            </button>
          )}
        </div>

        {/* Media gallery */}
        {hasMedia ? (
          <div className="mt-3 bg-gray-50">
            <MediaGallery media={media} onDelete={deleteMedia} onSetAudio={setMediaAudio} />
          </div>
        ) : null}

        {/* Quoted post card or "Mark as quoted" button */}
        {currentShare ? (
          <div className="mx-5 mt-3 mb-4 overflow-hidden rounded-lg border border-gray-300 bg-gray-50">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <LinkIcon className="h-3 w-3" />
                Quoted post on Facebook
              </div>
              <button
                type="button"
                onClick={async () => {
                  setCurrentShare(null);
                  await fetch(`/api/posts/${postId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ share: null }),
                  });
                }}
                className="text-[10px] font-medium text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
            <div className="px-3 py-2 text-[12px] leading-snug text-gray-700">
              {currentShare.url ? (
                <>
                  <div className="text-[11px] text-gray-500">
                    Shared{currentShare.source ? ` from ${currentShare.source}` : " link"}
                  </div>
                  {currentShare.name && (
                    <div className="mt-1 whitespace-pre-wrap text-gray-800">
                      {currentShare.name}
                    </div>
                  )}
                  <a
                    href={currentShare.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 break-all text-blue-600 hover:underline"
                  >
                    {currentShare.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </>
              ) : (
                <>
                  <div className="text-gray-800">
                    {currentShare.name || "Gil shared a post."}
                  </div>
                  <div className="mt-1 text-[11px] italic text-gray-500">
                    Facebook didn&apos;t preserve the embedded post&apos;s
                    content in the export, so we only have the header above.
                    Open the original via the FB link to see what was shared.
                  </div>
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="mx-5 mt-3 mb-4">
            <button
              type="button"
              onClick={async () => {
                const shareVal = { name: "Shared post" };
                setCurrentShare(shareVal);
                await fetch(`/api/posts/${postId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ share: shareVal }),
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-700 hover:border-amber-400 hover:bg-amber-50"
            >
              <LinkIcon className="h-3 w-3" />
              Mark as quoted post
            </button>
          </div>
        )}
      </article>

      {/* Tags — separate box */}
      <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Tags
            </p>
            <LifecycleChip
              postId={postId}
              initialLifecycle={initialLifecycle}
              initialSeason={initialSeason}
            />
          </div>
          <ReanalyzeButton postId={postId} />
        </div>
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
        </div>
      </div>

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

function MediaGallery({
  media,
  onDelete,
  onSetAudio,
}: {
  media: MediaItem[];
  onDelete: (id: string) => void;
  onSetAudio: (id: string, audioTrackId: string | null) => void;
}) {
  const count = media.length;

  if (count === 1) {
    return (
      <MediaHero
        media={media[0]}
        onDelete={() => onDelete(media[0].id)}
        onSetAudio={(tid) => onSetAudio(media[0].id, tid)}
      />
    );
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-1 p-1">
        {media.map((m) => (
          <MediaTile
            key={m.id}
            media={m}
            onDelete={() => onDelete(m.id)}
            onSetAudio={(tid) => onSetAudio(m.id, tid)}
            aspect="aspect-[4/5]"
          />
        ))}
      </div>
    );
  }

  if (count === 3) {
    return (
      <div className="flex gap-1 p-1">
        <div className="flex-1">
          <MediaTile
            media={media[0]}
            onDelete={() => onDelete(media[0].id)}
            onSetAudio={(tid) => onSetAudio(media[0].id, tid)}
            aspect="aspect-[3/4]"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          {[media[1], media[2]].map((m) => (
            <MediaTile
              key={m.id}
              media={m}
              onDelete={() => onDelete(m.id)}
              onSetAudio={(tid) => onSetAudio(m.id, tid)}
              aspect="aspect-[3/2]"
            />
          ))}
        </div>
      </div>
    );
  }

  const aspect = count === 4 ? "aspect-square" : "aspect-square";
  const cols = count === 4 ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3";
  return (
    <div className={`grid ${cols} gap-1 p-1`}>
      {media.map((m) => (
        <MediaTile
          key={m.id}
          media={m}
          onDelete={() => onDelete(m.id)}
          onSetAudio={(tid) => onSetAudio(m.id, tid)}
          aspect={aspect}
        />
      ))}
    </div>
  );
}

function MediaHero({
  media,
  onDelete,
  onSetAudio,
}: {
  media: MediaItem;
  onDelete: () => void;
  onSetAudio: (audioTrackId: string | null) => void;
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
      {isSilentVideo && !media.audioTrack && (
        <div
          className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white"
          title="No audio track"
        >
          <VolumeX className="h-3 w-3" />
          <span>silent</span>
        </div>
      )}
      {isVideo && media.audioTrack && (
        <div
          className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-purple-600/80 px-2.5 py-1 text-[10px] text-white"
          title={`Music overlay: ${media.audioTrack.title}`}
        >
          <Music className="h-3 w-3" />
          <span className="max-w-[12rem] truncate">{media.audioTrack.title}</span>
        </div>
      )}
      {isVideo && (
        <div className="absolute bottom-3 right-3">
          <AudioPicker media={media} onSetAudio={onSetAudio} />
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

interface AudioTrackSummary {
  id: string;
  title: string;
}

function AudioPicker({
  media,
  onSetAudio,
}: {
  media: MediaItem;
  onSetAudio: (audioTrackId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tracks, setTracks] = useState<AudioTrackSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function openPicker() {
    setOpen((v) => !v);
    if (tracks != null) return;
    setLoading(true);
    try {
      const res = await fetch("/api/audio");
      if (res.ok) {
        const data = (await res.json()) as AudioTrackSummary[];
        setTracks(data);
      }
    } finally {
      setLoading(false);
    }
  }

  const currentId = media.audioTrack?.id ?? null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openPicker}
        className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] text-white hover:bg-black/80"
        title="Add or change music"
      >
        <Music className="h-3 w-3" />
        <span>{media.audioTrack ? "Change" : "Add music"}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-56 rounded-md border border-gray-200 bg-white shadow-lg">
          <div className="max-h-64 overflow-y-auto py-1 text-xs">
            {loading && (
              <div className="px-3 py-2 text-gray-500">Loading…</div>
            )}
            {!loading && tracks && tracks.length === 0 && (
              <div className="px-3 py-2 text-gray-500">
                No tracks yet.{" "}
                <a href="/admin/audio" className="text-blue-600 hover:underline">
                  Upload one
                </a>
              </div>
            )}
            {currentId && (
              <button
                type="button"
                onClick={() => {
                  onSetAudio(null);
                  setOpen(false);
                }}
                className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50"
              >
                Remove music
              </button>
            )}
            {tracks?.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onSetAudio(t.id);
                  setOpen(false);
                }}
                className={`block w-full px-3 py-1.5 text-left hover:bg-gray-100 ${
                  t.id === currentId ? "bg-purple-50 font-medium text-purple-700" : ""
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-500">
            <a href="/admin/audio" className="text-blue-600 hover:underline">
              Manage library →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaTile({
  media,
  onDelete,
  onSetAudio,
  aspect = "aspect-square",
}: {
  media: MediaItem;
  onDelete: () => void;
  onSetAudio: (audioTrackId: string | null) => void;
  aspect?: string;
}) {
  const isVideo = media.mimeType.startsWith("video");
  const isSilentVideo = isVideo && media.hasAudio === false;

  return (
    <div className={`relative w-full overflow-hidden rounded-md bg-gray-100 ${aspect}`}>
      {media.url ? (
        isVideo ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video
            src={media.url}
            className="h-full w-full object-cover"
            controls
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
      {isSilentVideo && !media.audioTrack && (
        <div className="absolute bottom-1 left-1 rounded-full bg-black/60 p-0.5">
          <VolumeX className="h-3 w-3 text-white" />
        </div>
      )}
      {isVideo && media.audioTrack && (
        <div
          className="absolute bottom-1 left-1 rounded-full bg-purple-600/80 p-0.5"
          title={`Music: ${media.audioTrack.title}`}
        >
          <Music className="h-3 w-3 text-white" />
        </div>
      )}
      {isVideo && (
        <div className="absolute bottom-1 right-1">
          <AudioPicker media={media} onSetAudio={onSetAudio} />
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
