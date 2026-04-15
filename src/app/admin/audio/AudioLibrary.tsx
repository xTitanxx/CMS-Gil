"use client";

import { useCallback, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useDropzone } from "react-dropzone";
import { Music, Trash2, Upload } from "lucide-react";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;

const ACCEPTED = {
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a"],
  "audio/wav": [".wav"],
  "audio/aac": [".aac"],
  "audio/ogg": [".ogg"],
  "audio/webm": [".webm"],
};

interface Track {
  id: string;
  title: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSec: number | null;
  createdAt: string;
  url: string | null;
}

export function AudioLibrary({ initialTracks }: { initialTracks: Track[] }) {
  const [tracks, setTracks] = useState<Track[]>(initialTracks);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<string[]>([]);

  const uploadFile = useCallback(async (file: File) => {
    setError("");
    setUploading((u) => [...u, file.name]);
    try {
      let track: Track;
      if (file.size < DIRECT_UPLOAD_LIMIT) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/audio", { method: "POST", body: fd });
        if (!res.ok) throw new Error(await res.text());
        track = await res.json();
      } else {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob",
        });
        const res = await fetch("/api/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            blobUrl: blob.url,
            filename: file.name,
            mimeType: file.type || "audio/mpeg",
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        track = await res.json();
      }
      setTracks((prev) => [track, ...prev]);
    } catch {
      setError("Failed to upload. Try again.");
    } finally {
      setUploading((u) => u.filter((n) => n !== file.name));
    }
  }, []);

  const onDrop = useCallback(
    (accepted: File[]) => {
      accepted.forEach((f) => void uploadFile(f));
    },
    [uploadFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED,
    multiple: true,
    noClick: true,
  });

  async function renameTrack(id: string, title: string) {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
    await fetch(`/api/audio/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }

  async function deleteTrack(id: string) {
    if (!confirm("Delete this track? Posts using it will revert to silent.")) return;
    const res = await fetch(`/api/audio/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTracks((prev) => prev.filter((t) => t.id !== id));
    } else {
      setError("Failed to delete track.");
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);

  return (
    <div {...getRootProps()} className="relative">
      <input {...getInputProps()} />
      {isDragActive && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/90">
          <div className="flex flex-col items-center gap-2 text-blue-600">
            <Upload className="h-8 w-8" />
            <p className="text-sm font-medium">Drop audio files</p>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-white px-4 py-3 text-sm">
        <Upload className="h-4 w-4 text-gray-400" />
        <span className="text-gray-600">Drag audio files here, or</span>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="font-medium text-blue-600 hover:text-blue-800"
        >
          choose files
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={Object.keys(ACCEPTED).join(",")}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) Array.from(e.target.files).forEach((f) => void uploadFile(f));
            e.target.value = "";
          }}
        />
        {error && <span className="ml-auto text-red-600">{error}</span>}
      </div>

      {uploading.length > 0 && (
        <div className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Uploading: {uploading.join(", ")}
        </div>
      )}

      <div className="space-y-2">
        {tracks.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            No tracks yet. Upload MP3s or other audio files to start building your library.
          </div>
        )}
        {tracks.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3"
          >
            <div className="rounded-md bg-purple-100 p-2">
              <Music className="h-4 w-4 text-purple-600" />
            </div>
            <div className="min-w-0 flex-1">
              <input
                defaultValue={t.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== t.title) renameTrack(t.id, v);
                }}
                className="w-full truncate border-0 bg-transparent text-sm font-medium text-gray-900 focus:outline-none focus:ring-0"
              />
              {t.url && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <audio src={t.url} controls preload="none" className="mt-1 h-8 w-full" />
              )}
            </div>
            <button
              type="button"
              onClick={() => deleteTrack(t.id)}
              className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
              aria-label="Delete track"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
