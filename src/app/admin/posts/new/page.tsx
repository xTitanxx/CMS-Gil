"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { ArrowLeft, X, ImagePlus, Music } from "lucide-react";
import Link from "next/link";
import { uploadPostMedia } from "@/lib/client/uploadPostMedia";
import { AudioPicker } from "@/app/admin/_shared/AudioPicker";

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

interface SelectedFile {
  file: File;
  preview: string; // object URL for both images and videos
}

export default function NewPostPage() {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // Per-file upload percentages keyed by index in `files`. Drives the
  // progress bar overlaid on each media tile during phase 2.
  const [uploadPct, setUploadPct] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // Revoke all object URLs on unmount
  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => URL.revokeObjectURL(f.preview));
    };
  }, []);

  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  const onDrop = useCallback((accepted: File[]) => {
    const next: SelectedFile[] = accepted.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const {
    getRootProps,
    getInputProps,
    isDragActive,
    open: openFilePicker,
  } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    multiple: true,
    noClick: true, // only drag-drop on the card; buttons trigger picker explicitly
  });

  function removeFile(index: number) {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      URL.revokeObjectURL(removed.preview);
      return copy;
    });
  }

  async function handlePost() {
    if (!body.trim()) {
      setError("Post content is required.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Phase 1: Create the post — use current time (no date picker)
      const postRes = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: body.trim(), intendedForFacebook: true }),
      });

      if (!postRes.ok) {
        const msg = await postRes.text().catch(() => "");
        setError(`Failed to create post: ${msg || postRes.statusText}`);
        setSubmitting(false);
        return;
      }

      const post = await postRes.json();
      const postId: string = post.id;

      // Phase 2: Upload media in parallel
      if (files.length > 0) {
        let completed = 0;
        const failures: { name: string; reason: string }[] = [];
        setProgress(`Uploading (0/${files.length})…`);
        setUploadPct({});

        const uploadedMedia = await Promise.all(
          files.map(async (selected, index) => {
            try {
              const uploaded = await uploadPostMedia(postId, selected.file, {
                onProgress: (pct) =>
                  setUploadPct((prev) => ({ ...prev, [index]: pct })),
              });
              return uploaded;
            } catch (err) {
              const reason = err instanceof Error ? err.message : String(err);
              console.error("Media upload failed:", selected.file.name, err);
              failures.push({ name: selected.file.name, reason });
              return null;
            } finally {
              completed++;
              setProgress(`Uploading (${completed}/${files.length})…`);
            }
          }),
        );

        // Phase 3: Apply selected music track to any uploaded videos
        if (selectedAudioTrackId) {
          const videoMedia = uploadedMedia.filter(
            (m) => m !== null && m.mimeType.startsWith("video/"),
          );
          await Promise.all(
            videoMedia.map((m) =>
              fetch(`/api/posts/${postId}/media/${m!.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ audioTrackId: selectedAudioTrackId }),
              }).catch(console.error),
            ),
          );
        }

        if (failures.length > 0) {
          const summary = failures.length === 1
            ? `${failures[0].name} failed to upload: ${failures[0].reason}`
            : `${failures.length} files failed to upload. First error: ${failures[0].reason}`;
          setError(`${summary} The post was still created.`);
          setSubmitting(false);
          return;
        }
      }

      router.push(
        `/admin/m/${postId}?from=${encodeURIComponent(`/admin/posts/${postId}`)}&fresh=1`,
      );
    } catch (err) {
      console.error("Unexpected error:", err);
      setError("An unexpected error occurred. Please try again.");
      setSubmitting(false);
    }
  }

  const canPost = !submitting && body.trim().length > 0;

  return (
    <div className="max-w-[520px] space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/admin/posts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
        </Link>
      </div>

      {/* Facebook-style composer card */}
      <div
        {...getRootProps()}
        className={`relative rounded-xl border bg-white shadow-md transition-colors ${
          isDragActive
            ? "border-blue-400 ring-2 ring-blue-100"
            : "border-gray-200"
        }`}
      >
        {/* Hidden dropzone input */}
        <input {...getInputProps()} />

        {/* Text area — auto-grows */}
        <div className="px-4 pt-4 pb-2">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setError(null);
              autoResize(e.target);
            }}
            placeholder="Write something…"
            rows={3}
            className="w-full resize-none bg-transparent text-lg placeholder:text-gray-400 focus:outline-none"
            style={{ minHeight: "72px" }}
            autoFocus
          />
        </div>

        {/* Media preview — inline below text */}
        {files.length > 0 && (
          <div className="relative border-t border-gray-100">
            <MediaGrid
              files={files}
              onRemove={removeFile}
              uploadPct={uploadPct}
              isUploading={submitting}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFilePicker();
              }}
              className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-sm hover:bg-white"
            >
              <ImagePlus className="h-3.5 w-3.5" />
              Add more
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 break-words">
            {error}
          </div>
        )}

        {/* Divider */}
        <div className="mx-4 border-t border-gray-100" />

        {/* Toolbar */}
        <div className="flex items-center gap-1 px-3 py-3">
          {/* Photo/Video button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openFilePicker();
            }}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-green-600 transition-colors hover:bg-green-50"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="hidden sm:inline">Photo/Video</span>
          </button>

          {/* Add Music button */}
          <div
            className="flex items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <AudioPicker
              currentTrack={
                selectedAudioTrackId
                  ? { id: selectedAudioTrackId, title: "" }
                  : null
              }
              onSetAudio={setSelectedAudioTrackId}
            />
          </div>

          {/* Show track-attached indicator */}
          {selectedAudioTrackId && (
            <span className="flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
              <Music className="h-3 w-3" />
              Music added
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Post button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handlePost();
            }}
            disabled={!canPost}
            className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? (progress ?? "Posting…") : "Post"}
          </button>
        </div>

        {/* Drag-over overlay hint */}
        {isDragActive && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-blue-50/80">
            <p className="text-base font-medium text-blue-600">Drop files here</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Media Grid ──────────────────────────────────────────────────────────────

interface MediaGridProps {
  files: SelectedFile[];
  onRemove: (index: number) => void;
  uploadPct: Record<number, number>;
  isUploading: boolean;
}

function MediaGrid({ files, onRemove, uploadPct, isUploading }: MediaGridProps) {
  const count = files.length;
  const itemPropsAt = (i: number) => ({
    file: files[i],
    onRemove: () => onRemove(i),
    pct: uploadPct[i],
    isUploading,
  });

  if (count === 1) {
    return <MediaItem {...itemPropsAt(0)} variant="single" />;
  }

  if (count === 2) {
    return (
      <div className="grid grid-cols-2 gap-0.5">
        {files.map((_, i) => (
          <MediaItem key={i} {...itemPropsAt(i)} variant="grid" />
        ))}
      </div>
    );
  }

  if (count === 3) {
    // Facebook 3-photo layout: 1 large on left, 2 stacked on right
    return (
      <div className="grid gap-0.5" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <div className="row-span-2">
          <MediaItem {...itemPropsAt(0)} variant="tall" />
        </div>
        <MediaItem {...itemPropsAt(1)} variant="grid" />
        <MediaItem {...itemPropsAt(2)} variant="grid" />
      </div>
    );
  }

  // 4+ items: 2-column grid, first row wider if odd count
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {files.map((_, i) => (
        <MediaItem key={i} {...itemPropsAt(i)} variant="grid" />
      ))}
    </div>
  );
}

// ─── Media Item ──────────────────────────────────────────────────────────────

type MediaVariant = "single" | "grid" | "tall";

interface MediaItemProps {
  file: SelectedFile;
  onRemove: () => void;
  variant: MediaVariant;
  pct: number | undefined;
  isUploading: boolean;
}

const VARIANT_CLASS: Record<MediaVariant, string> = {
  single: "max-h-80 w-full",
  grid: "h-44 w-full",
  tall: "h-full w-full min-h-[11rem]",
};

function MediaItem({ file, onRemove, variant, pct, isUploading }: MediaItemProps) {
  const isVideo = file.file.type.startsWith("video/");
  const containerClass = VARIANT_CLASS[variant];
  // Videos: contain (no cropping), images: cover (fill cell)
  const fitClass = isVideo ? "object-contain" : "object-cover";
  // While the upload is running, show an overlay even before the first
  // progress event lands so the user gets immediate feedback. Once a
  // percentage arrives it drives the bar fill; otherwise we render an
  // indeterminate pulsing strip at 5%.
  const showOverlay = isUploading;
  const fillPct = pct ?? 0;
  const indeterminate = isUploading && pct === undefined;

  return (
    <div className={`relative overflow-hidden bg-black ${containerClass}`}>
      {isVideo ? (
        <video
          src={file.preview}
          controls
          className={`h-full w-full ${fitClass}`}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.preview} alt="" className={`h-full w-full ${fitClass}`} />
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        disabled={isUploading}
        className="absolute right-2 top-2 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <X className="h-4 w-4" />
      </button>
      {showOverlay && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-black/40" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 p-2">
            <div className="text-xs font-semibold tabular-nums text-white drop-shadow">
              {pct === 100 ? "Finishing…" : indeterminate ? "Starting…" : `${fillPct}%`}
            </div>
            <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-white/30">
              <div
                className={`h-full bg-white transition-[width] duration-200 ease-out ${
                  indeterminate ? "animate-pulse" : ""
                }`}
                style={{ width: `${indeterminate ? 5 : fillPct}%` }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
