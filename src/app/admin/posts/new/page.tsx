"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, X, Film, Upload } from "lucide-react";
import Link from "next/link";

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

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024; // 4 MB

interface SelectedFile {
  file: File;
  preview: string | null; // object URL for images, null for videos
}

function toDatetimeLocal(d: Date): string {
  // Produces "YYYY-MM-DDTHH:mm" in local time for datetime-local input
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NewPostPage() {
  const router = useRouter();

  const [body, setBody] = useState("");
  const [bodyError, setBodyError] = useState("");
  const [date, setDate] = useState(() => toDatetimeLocal(new Date()));
  const [files, setFiles] = useState<SelectedFile[]>([]);

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    return () => {
      filesRef.current.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []); // runs only on unmount

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[]) => {
    const next: SelectedFile[] = accepted.map((file) => ({
      file,
      preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
    }));
    setFiles((prev) => [...prev, ...next]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_MIME_TYPES,
    multiple: true,
  });

  function removeFile(index: number) {
    setFiles((prev) => {
      const copy = [...prev];
      const removed = copy.splice(index, 1)[0];
      if (removed.preview) URL.revokeObjectURL(removed.preview);
      return copy;
    });
  }

  async function uploadMediaFile(postId: string, selected: SelectedFile): Promise<void> {
    const { file } = selected;

    if (file.size < DIRECT_UPLOAD_LIMIT) {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/posts/${postId}/media`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
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
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!body.trim()) {
      setBodyError("Post content is required.");
      return;
    }
    setBodyError("");
    setSubmitting(true);
    setError(null);

    try {
      // Phase 1: Create the post
      const postRes = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body.trim(),
          originalDate: new Date(date).toISOString(),
        }),
      });

      if (!postRes.ok) {
        setError("Failed to create post. Please try again.");
        setSubmitting(false);
        return;
      }

      const post = await postRes.json();
      const postId: string = post.id;

      // Phase 2: Upload media files
      if (files.length > 0) {
        let completed = 0;
        const failedCount = { value: 0 };
        setProgress(`Uploading media (0/${files.length})...`);

        await Promise.all(
          files.map(async (selected) => {
            try {
              await uploadMediaFile(postId, selected);
            } catch {
              failedCount.value++;
            } finally {
              completed++;
              setProgress(`Uploading media (${completed}/${files.length})...`);
            }
          })
        );

        if (failedCount.value > 0) {
          setError(
            `${failedCount.value} file${failedCount.value === 1 ? "" : "s"} failed to upload. The post was still created.`
          );
          setSubmitting(false);
          return;
        }
      }

      router.push(`/admin/posts/${postId}`);
    } catch {
      setError("An unexpected error occurred. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <Link href="/admin/posts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Post</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Content */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Content</CardTitle>
          </CardHeader>
          <CardContent>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setBodyError("");
              }}
              placeholder="What's on your mind?"
              rows={5}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none resize-none"
            />
            {bodyError && (
              <p className="mt-1 text-xs text-red-600">{bodyError}</p>
            )}
          </CardContent>
        </Card>

        {/* Media */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Media</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              {...getRootProps()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-8 text-center transition-colors ${
                isDragActive
                  ? "border-blue-400 bg-blue-50"
                  : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="h-6 w-6 text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">
                {isDragActive ? "Drop files here" : "Click or drag files here"}
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Images (JPG, PNG, GIF, WebP, HEIC) and videos (MP4, MOV)
              </p>
            </div>

            {files.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {files.map((selected, i) => (
                  <div
                    key={i}
                    className="relative aspect-square overflow-hidden rounded-lg bg-gray-100"
                  >
                    {selected.preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selected.preview}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center p-2">
                        <Film className="h-6 w-6 text-gray-400" />
                        <span className="mt-1 text-center text-xs text-gray-500 line-clamp-2">
                          {selected.file.name}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Date */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Date</CardTitle>
          </CardHeader>
          <CardContent>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </CardContent>
        </Card>

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={submitting}>
            {submitting ? (progress ?? "Creating...") : "Create Post"}
          </Button>
          <Link href="/admin/posts">
            <Button type="button" variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
