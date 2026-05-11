"use client";

const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;

export interface UploadedMedia {
  id: string;
  mimeType: string;
  url: string | null;
  hasAudio?: boolean | null;
}

export interface UploadOptions {
  // Called repeatedly with percent 0-100. The small-file direct-POST path
  // can't measure browser fetch progress, so it just jumps 0 → 100. The
  // direct-to-R2 path streams real percentages via XHR upload.onprogress,
  // capped at 95% so the bar reserves room for the server-side attach step.
  onProgress?: (percent: number) => void;
}

export async function uploadPostMedia(
  postId: string,
  file: File,
  opts: UploadOptions = {},
): Promise<UploadedMedia> {
  const onProgress = opts.onProgress;

  if (file.size < DIRECT_UPLOAD_LIMIT) {
    onProgress?.(0);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`/api/posts/${postId}/media`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) throw new Error(await res.text());
    onProgress?.(100);
    return (await res.json()) as UploadedMedia;
  }

  // Step 1: Mint a presigned PUT URL pointing at R2.
  let presignBody: { url: string; key: string };
  try {
    const presignRes = await fetch(`/api/posts/${postId}/media/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });
    if (!presignRes.ok) {
      const msg = await presignRes.text().catch(() => "");
      throw new Error(msg || `presign HTTP ${presignRes.status}`);
    }
    presignBody = (await presignRes.json()) as { url: string; key: string };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Upload failed: ${msg}`);
  }

  // Step 2: PUT the file directly to R2 with XHR so we can wire upload
  // progress. The Content-Type header is bound into the presigned URL and
  // MUST match what the server signed — otherwise R2 rejects the PUT.
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", presignBody.url);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = (evt.loaded / evt.total) * 100;
        // Reserve the last 5% for the server-side attach step (R2 fetch +
        // sniff + DB write) so the bar doesn't sit at 100% while we're
        // still waiting on the second request.
        onProgress?.(Math.round(pct * 0.95));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(
            new Error(
              `R2 PUT ${xhr.status}${xhr.statusText ? `: ${xhr.statusText}` : ""}`,
            ),
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error("network error during upload"));
      xhr.onabort = () => reject(new Error("upload aborted"));
      xhr.send(file);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Upload failed: ${msg}`);
  }

  // Step 3: Tell the server the upload is complete. The server fetches the
  // file back from R2 to sniff its MIME (defense in depth) and kicks off
  // poster extraction + audio probe.
  const res = await fetch(`/api/posts/${postId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: presignBody.key,
      filename: file.name,
      mimeType: file.type,
    }),
  });
  if (!res.ok) throw new Error(`Media attach failed: ${await res.text()}`);
  onProgress?.(100);
  return (await res.json()) as UploadedMedia;
}
