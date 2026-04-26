"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { uploadPostMedia } from "@/lib/client/uploadPostMedia";
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
  ChevronDown,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { ReanalyzeButton } from "./PostInteractions";
import { LifecycleChip } from "./LifecycleChip";
import { StarRow } from "@/components/StarRow";

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
  url?: string | null;
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

interface CaptionSuggestionData {
  postId: string;
  currentBody: string;
  suggestion: string | null;
  quality: number | null;
  evergreen: boolean | null;
}

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
  rating: { stars: number; reasons: string[]; note: string | null } | null;
  captionSuggestion?: CaptionSuggestionData | null;
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
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
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
  rating,
  captionSuggestion,
}: PostEditorProps) {
  const [body, setBody] = useState(initialBody);
  const [currentStars, setCurrentStars] = useState<number | null>(rating?.stars ?? null);
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
  const [detailsOpen, setDetailsOpen] = useState(false);
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
      const newMedia = await uploadPostMedia(postId, file);
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

      <article className="relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        {/* Floating save indicator */}
        {saveStatus !== "idle" && (
          <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] shadow-sm backdrop-blur-sm">
            {saveStatus === "saving" && <span className="text-gray-500">Saving…</span>}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-1 text-green-600">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
            {saveStatus === "error" && (
              <span className="flex items-center gap-1 text-red-600">
                <AlertCircle className="h-3 w-3" /> Error
              </span>
            )}
          </div>
        )}

        {/* Compact meta bar */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-2.5 text-xs text-gray-500">
          <span className="flex items-center gap-1.5 whitespace-nowrap">
            <Calendar className="h-3 w-3 text-gray-400" />
            {editingDate ? (
              <input
                type="datetime-local"
                value={date}
                autoFocus
                onBlur={() => setEditingDate(false)}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-gray-200 px-2 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingDate(true)}
                className="whitespace-nowrap rounded px-1 py-0.5 text-gray-700 hover:bg-gray-100"
              >
                {formatDatePretty(date) || "Set date"}
              </button>
            )}
          </span>
          <span className="text-gray-300">·</span>
          <span className="whitespace-nowrap rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
            {postType === "POST" ? "Post" : postType === "REEL" ? "Reel" : "Story"}
          </span>
          {currentPlatformUrl && (
            <>
              <span className="text-gray-300">·</span>
              <a
                href={currentPlatformUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 whitespace-nowrap text-blue-600 hover:underline"
              >
                Original <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}
        </div>

        {/* Media gallery — full bleed */}
        {hasMedia && (
          <div className="relative">
            <MediaGallery media={media} onDelete={deleteMedia} onSetAudio={setMediaAudio} />
            <div className="absolute bottom-3 left-3 z-10">
              <UploadButton
                onSelect={(files) => onDrop(Array.from(files))}
                render={(onClick) => (
                  <button
                    type="button"
                    onClick={onClick}
                    className="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm hover:bg-white transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add media
                  </button>
                )}
              />
            </div>
          </div>
        )}
        {!hasMedia && (
          <div className="flex items-center justify-center border-b border-gray-100 bg-gray-50 py-8">
            <UploadButton
              onSelect={(files) => onDrop(Array.from(files))}
              render={(onClick) => (
                <button
                  type="button"
                  onClick={onClick}
                  className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-5 py-3 text-sm text-gray-500 shadow-sm hover:border-gray-400 hover:text-gray-700 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  Add photos or video
                </button>
              )}
            />
          </div>
        )}

        {/* Caption */}
        <div className="px-5 py-4">
          <div
            className={
              isLong && !expanded
                ? "max-h-[6rem] overflow-hidden"
                : undefined
            }
          >
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write a caption…"
              rows={1}
              className="w-full resize-none overflow-hidden border-0 bg-transparent text-sm leading-relaxed text-gray-800 placeholder:text-gray-400 focus:outline-none"
            />
          </div>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 rounded-md px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 hover:text-blue-700 transition-colors"
            >
              {expanded ? "See less" : "See more"}
            </button>
          )}
        </div>

        {/* Quoted post card */}
        {currentShare && (
          <div className="mx-5 mb-4 overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
            <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-3 py-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                <LinkIcon className="h-3 w-3" />
                Quoted post
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
            <div className="px-3 py-2 text-xs leading-snug text-gray-700">
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
                <div className="text-gray-800">
                  {currentShare.name || "Shared a post."}
                </div>
              )}
            </div>
          </div>
        )}
      </article>

      {mediaError && (
        <div className="mt-1.5 px-1 text-[11px] text-red-600">{mediaError}</div>
      )}

      {/* Collapsible details — secondary metadata */}
      <div className="mt-3 rounded-2xl border border-gray-100 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <span>Details</span>
          <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${detailsOpen ? "rotate-180" : ""}`} />
        </button>
        {detailsOpen && (
          <div className="space-y-4 border-t border-gray-100 px-4 pb-4 pt-3">
            {/* Tags */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">Tags</span>
                <ReanalyzeButton postId={postId} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-700"
                  >
                    {tag}
                    <button
                      onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                      className="text-gray-400 transition-colors hover:text-gray-700"
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
                  className="min-w-[4rem] rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            </div>

            {/* Rating */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Rating</span>
              <StarRow
                value={currentStars}
                onChange={async (v) => {
                  setCurrentStars(v);
                  await fetch("/api/ratings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      postId,
                      stars: v,
                      reasons: rating?.reasons ?? [],
                    }),
                  });
                }}
              />
            </div>

            {/* Lifecycle */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Lifecycle</span>
              <LifecycleChip
                postId={postId}
                initialLifecycle={initialLifecycle}
                initialSeason={initialSeason}
              />
            </div>

            {/* Type */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Type</span>
              <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
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
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
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

            {/* Source */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Source</span>
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                {source}
              </span>
            </div>

            {/* Original link */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">Original link</span>
              {editingLink ? (
                <input
                  type="url"
                  autoFocus
                  value={linkDraft}
                  onChange={(e) => setLinkDraft(e.target.value)}
                  placeholder="https://…"
                  className="w-48 rounded-md border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
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
              ) : currentPlatformUrl ? (
                <span className="flex items-center gap-1.5 text-xs">
                  <a
                    href={currentPlatformUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => { setLinkDraft(currentPlatformUrl); setEditingLink(true); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    edit
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => { setLinkDraft(""); setEditingLink(true); }}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
                >
                  <LinkIcon className="h-3 w-3" />
                  Add link
                </button>
              )}
            </div>

            {/* Caption improvement (inline) */}
            {captionSuggestion && (captionSuggestion.quality != null || captionSuggestion.suggestion) && (
              <CaptionSuggestionInline {...captionSuggestion} />
            )}

            {/* Mark as quoted post */}
            {!currentShare && (
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
            )}
          </div>
        )}
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

function SyncedAudioVideo({
  videoSrc,
  audioSrc,
  className,
  controls = true,
}: {
  videoSrc: string;
  audioSrc: string;
  className?: string;
  controls?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    const syncPlay = () => {
      audio.currentTime = video.currentTime;
      audio.play();
    };
    const syncPause = () => audio.pause();
    const syncSeek = () => {
      audio.currentTime = video.currentTime;
    };

    video.addEventListener("play", syncPlay);
    video.addEventListener("pause", syncPause);
    video.addEventListener("seeked", syncSeek);

    return () => {
      video.removeEventListener("play", syncPlay);
      video.removeEventListener("pause", syncPause);
      video.removeEventListener("seeked", syncSeek);
    };
  }, [audioSrc]);

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} src={videoSrc} muted controls={controls} playsInline className={className} />
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={audioRef} src={audioSrc} preload="metadata" />
    </>
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
    <div className="relative flex-1 overflow-hidden rounded-xl">
      {media.url ? (
        isVideo ? (
          media.audioTrack?.url ? (
            <SyncedAudioVideo
              videoSrc={media.url}
              audioSrc={media.audioTrack.url}
              className="mx-auto max-h-[50vh] w-full object-contain bg-black"
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={media.url}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="mx-auto max-h-[50vh] w-full object-contain bg-black"
            />
          )
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
          className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-gray-900/70 px-2.5 py-1 text-[10px] text-white backdrop-blur-sm"
          title="No audio track"
        >
          <VolumeX className="h-3 w-3" />
          <span>silent</span>
        </div>
      )}
      {isVideo && media.audioTrack && (
        <div
          className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-purple-600/70 px-2.5 py-1 text-[10px] text-white backdrop-blur-sm"
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
      <MediaDeleteButton onDelete={onDelete} size="lg" />
    </div>
  );
}

interface AudioTrackSummary {
  id: string;
  title: string;
  url?: string | null;
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
        className="flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[10px] text-gray-700 shadow-sm backdrop-blur-sm hover:bg-white"
        title="Add or change music"
      >
        <Music className="h-3 w-3" />
        <span>{media.audioTrack ? "Change" : "Add music"}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-1 w-56 rounded-xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur-sm">
          <div className="max-h-64 overflow-y-auto p-1 text-xs">
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
                className="mx-1 block w-[calc(100%-0.5rem)] rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50"
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
                className={`mx-1 block w-[calc(100%-0.5rem)] rounded-lg px-2.5 py-1.5 text-left hover:bg-gray-50 ${
                  t.id === currentId ? "bg-purple-50 font-medium text-purple-700 ring-1 ring-purple-200" : ""
                }`}
              >
                {t.title}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
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
    <div className={`relative w-full overflow-hidden rounded-lg ring-1 ring-black/5 transition-shadow hover:shadow-md bg-gray-100 ${aspect}`}>
      {media.url ? (
        isVideo ? (
          media.audioTrack?.url ? (
            <SyncedAudioVideo
              videoSrc={media.url}
              audioSrc={media.audioTrack.url}
              className="h-full w-full object-cover"
            />
          ) : (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              src={media.url}
              className="h-full w-full object-cover"
              controls
              playsInline
            />
          )
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
        <div className="absolute bottom-1 left-1 rounded-full bg-gray-900/70 p-0.5 backdrop-blur-sm">
          <VolumeX className="h-3 w-3 text-white" />
        </div>
      )}
      {isVideo && media.audioTrack && (
        <div
          className="absolute bottom-1 left-1 rounded-full bg-purple-600/70 p-0.5 backdrop-blur-sm"
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
      <MediaDeleteButton onDelete={onDelete} size="sm" />
    </div>
  );
}

function MediaDeleteButton({ onDelete, size }: { onDelete: () => void; size: "sm" | "lg" }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (size === "sm") {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirming) {
            onDelete();
          } else {
            setConfirming(true);
          }
        }}
        className={`absolute right-1 top-1 rounded-full p-0.5 backdrop-blur-sm transition-colors ${
          confirming
            ? "bg-red-600 text-white"
            : "bg-black/60 text-white hover:bg-black/80"
        }`}
        aria-label={confirming ? "Confirm delete" : "Delete media"}
      >
        {confirming ? <Trash2 className="h-3 w-3" /> : <X className="h-3 w-3" />}
      </button>
    );
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (confirming) {
          onDelete();
        } else {
          setConfirming(true);
        }
      }}
      className={`absolute right-3 top-3 rounded-full p-1.5 backdrop-blur-sm transition-all ${
        confirming
          ? "bg-red-600 text-white shadow-lg ring-2 ring-red-400/50"
          : "bg-gray-900/70 text-white hover:bg-black/80"
      }`}
      aria-label={confirming ? "Confirm delete" : "Delete media"}
    >
      {confirming ? <Trash2 className="h-4 w-4" /> : <X className="h-4 w-4" />}
    </button>
  );
}

function UploadButton({
  onSelect,
  render,
}: {
  onSelect: (files: FileList) => void;
  render?: (onClick: () => void) => React.ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const click = () => ref.current?.click();
  return (
    <>
      {render ? (
        render(click)
      ) : (
        <button
          type="button"
          onClick={click}
          className="font-medium text-blue-600 hover:text-blue-800"
        >
          choose files
        </button>
      )}
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

function CaptionSuggestionInline({
  postId,
  currentBody,
  suggestion,
  quality,
  evergreen,
}: CaptionSuggestionData) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  if (hidden) return null;

  async function accept() {
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setHidden(true);
      router.refresh();
    }
  }

  async function dismiss() {
    setBusy(true);
    const res = await fetch(`/api/posts/${postId}/caption-suggestion`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setHidden(true);
      router.refresh();
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
        Caption improvement
        {quality != null && (
          <span className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            quality {quality}/5
          </span>
        )}
        {evergreen === false && (
          <span className="rounded border border-amber-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
            non-evergreen
          </span>
        )}
      </div>
      {suggestion && (
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-600">Current</p>
            <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap rounded border border-amber-200 bg-white/70 px-2 py-1.5 text-xs text-gray-700">
              {currentBody}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-amber-600">Suggested</p>
            <p className="mt-0.5 whitespace-pre-wrap rounded border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-900">
              {suggestion}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={accept}
              disabled={busy}
              className="flex items-center gap-1 rounded-md bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              Accept
            </button>
            <button
              onClick={dismiss}
              disabled={busy}
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
