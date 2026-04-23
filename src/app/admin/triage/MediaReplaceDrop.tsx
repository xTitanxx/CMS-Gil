"use client";

import { useState, useRef, useCallback } from "react";
import { upload } from "@vercel/blob/client";
import { Upload, Loader2, CheckCircle } from "lucide-react";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

const ACCEPTED_VIDEO_TYPES = {
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
};
const ACCEPTED_MIME_SET = new Set(Object.keys(ACCEPTED_VIDEO_TYPES));

interface Props {
  mediaId: string;
  onDone: () => void;
}

export function MediaReplaceDrop({ mediaId, onDone }: Props) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (uploading) return;
      if (!ACCEPTED_MIME_SET.has(file.type)) {
        setError("Only .mp4 and .mov files accepted.");
        return;
      }

      setUploading(true);
      setProgress(0);
      setError(null);

      try {
        if (file.size < DIRECT_UPLOAD_LIMIT) {
          // Small file — send multipart directly to replace route
          setProgress(30);
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(`/api/media/${mediaId}/replace`, {
            method: "POST",
            body: formData,
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "Unknown error");
            throw new Error(text);
          }
          setProgress(100);
        } else {
          // Large file — stage to Vercel Blob first, then POST blobUrl to replace route
          const blob = await upload(file.name, file, {
            access: "public",
            handleUploadUrl: "/api/blob",
            onUploadProgress: ({ percentage }) =>
              setProgress(Math.round(percentage * 0.8)), // 0–80% for blob upload
          });

          setProgress(85);
          const res = await fetch(`/api/media/${mediaId}/replace`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blobUrl: blob.url,
              filename: file.name,
              mimeType: file.type,
            }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "Unknown error");
            throw new Error(text);
          }
          setProgress(100);
        }

        setDone(true);
        // Give a moment for the success state to render, then call onDone
        setTimeout(onDone, 800);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed. Try again.");
        setUploading(false);
        setProgress(0);
      }
    },
    [mediaId, onDone, uploading]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) void handleFile(file);
    },
    [handleFile]
  );

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = () => setDragging(false);

  if (done) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
        <CheckCircle className="h-4 w-4 shrink-0" />
        Replaced! Refreshing…
      </div>
    );
  }

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
        dragging
          ? "border-blue-400 bg-blue-50"
          : "border-gray-200 bg-gray-50 hover:border-gray-300"
      } ${uploading ? "pointer-events-none opacity-70" : "cursor-pointer"}`}
      onClick={() => !uploading && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      aria-label="Drop or click to replace video"
    >
      <input
        ref={inputRef}
        type="file"
        accept={Object.keys(ACCEPTED_VIDEO_TYPES).join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />

      {uploading ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
          <span className="text-xs font-medium text-blue-600">
            Uploading… {progress}%
          </span>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <Upload className="h-5 w-5 text-gray-400" />
          <p className="text-xs text-gray-500">
            Drop a new video or{" "}
            <span className="font-medium text-blue-600">choose file</span>
          </p>
          <p className="text-[10px] text-gray-400">.mp4 or .mov</p>
        </>
      )}

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  );
}
