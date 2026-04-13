# Multi-ZIP Facebook Import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support importing Facebook exports that are split across multiple ZIP downloads, where JSON data is in one ZIP and media files are scattered across others.

**Architecture:** Client uploads each ZIP to Vercel Blob (already in place at `/api/blob`), collects the Blob URLs, then sends them all to a new API endpoint. The backend streams each ZIP from Blob, merges all media entries into one shared map, parses all JSON files, and runs the existing import pipeline. Blob files are cleaned up after processing.

**Tech Stack:** `@vercel/blob` (client upload + server `del`), `unzipper`, existing `parseFacebookFile` + `runImportJob`

---

## File Structure

- **Modify:** `src/app/(dashboard)/import/page.tsx` — multi-file dropzone, sequential Blob uploads, progress UI
- **Create:** `src/app/api/import/process/route.ts` — new endpoint that accepts Blob URLs and processes multi-ZIP import
- **Keep:** `src/app/api/import/upload/route.ts` — unchanged, still works for single ZIP/JSON uploads
- **Keep:** `src/lib/facebook-parser.ts` — unchanged, parser is correct
- **Keep:** `src/lib/import-worker.ts` — unchanged, receives merged data

---

### Task 1: Create the multi-ZIP processing API route

**Files:**
- Create: `src/app/api/import/process/route.ts`

This route accepts a JSON body with an array of Blob URLs, opens each ZIP, merges all media entries and JSON content, then runs the import.

- [ ] **Step 1: Create the route file**

```ts
// src/app/api/import/process/route.ts
import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runImportJob } from "@/lib/import-worker";
import { parseFacebookFile, ParsedPost } from "@/lib/facebook-parser";
import { del } from "@vercel/blob";
import unzipper from "unzipper";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await req.json();
  const blobUrls: string[] = body.blobUrls;

  if (!Array.isArray(blobUrls) || blobUrls.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: {
      userId,
      filename: `${blobUrls.length} ZIP files`,
      source: "UPLOAD",
      status: "PENDING",
    },
  });

  after(async () => {
    try {
      await processMultiZip(job.id, userId, blobUrls);
    } catch (err) {
      console.error("Multi-ZIP import error:", err);
      await prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          errorLog: JSON.stringify([String(err)]),
          completedAt: new Date(),
        },
      });
    } finally {
      // Clean up all Blob files regardless of success/failure
      for (const url of blobUrls) {
        del(url).catch(() => {});
      }
    }
  });

  return NextResponse.json({ jobId: job.id });
}

type ZipEntry = unzipper.File;

async function processMultiZip(
  jobId: string,
  userId: string,
  blobUrls: string[]
): Promise<void> {
  // Merged state across all ZIPs
  const mediaEntries = new Map<string, { url: string; entry: ZipEntry; dir: unzipper.CentralDirectory }>();
  const jsonContents: string[] = [];

  // We need to keep directory references alive so entries remain readable.
  // Store them in an array so they aren't garbage collected.
  const directories: unzipper.CentralDirectory[] = [];

  for (const blobUrl of blobUrls) {
    const res = await fetch(blobUrl);
    if (!res.ok) {
      throw new Error(`Failed to download ZIP from Blob: ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const directory = await unzipper.Open.buffer(buffer);
    directories.push(directory);

    for (const entry of directory.files) {
      if (entry.path.includes("__MACOSX") || entry.path.endsWith("/")) continue;

      const filename = entry.path.split("/").pop() ?? "";

      if (entry.path.match(/\.json$/i)) {
        const entryBuffer = await entry.buffer();
        jsonContents.push(entryBuffer.toString("utf-8"));
      } else if (entry.path.match(/\.(jpg|jpeg|png|gif|webp|mp4|mov|avi|webm|heic)$/i)) {
        // Store by full path, normalized path, and filename-only
        const normalized = entry.path.replace(/^\/+/, "");
        const ref = { url: blobUrl, entry, dir: directory };
        mediaEntries.set(entry.path, ref);
        mediaEntries.set(normalized, ref);
        // Also store by the relative path WITHOUT the top-level facebook folder prefix
        // e.g. "facebook-gilalter7-.../your_facebook_activity/posts/media/..." 
        //    -> "your_facebook_activity/posts/media/..."
        // This matches the URI format used in the JSON files
        const parts = normalized.split("/");
        if (parts.length > 1) {
          // Try stripping the first directory segment (the facebook-xxx folder)
          const withoutPrefix = parts.slice(1).join("/");
          if (!mediaEntries.has(withoutPrefix)) {
            mediaEntries.set(withoutPrefix, ref);
          }
        }
        if (filename && !mediaEntries.has(filename)) {
          mediaEntries.set(filename, ref);
        }
      }
    }
  }

  if (jsonContents.length === 0) {
    throw new Error("No JSON files found in the uploaded ZIPs. Make sure you're uploading Facebook data exports.");
  }

  // Parse all JSON files
  const allPosts: ParsedPost[] = [];
  for (const jsonContent of jsonContents) {
    try {
      const raw = JSON.parse(jsonContent);
      const posts = parseFacebookFile(raw);
      allPosts.push(...posts);
    } catch {
      // Skip unparseable JSON files
    }
  }

  if (allPosts.length === 0) {
    throw new Error("No posts found in the exported JSON files.");
  }

  // Lazy media loader — reads one file at a time from the ZIP buffers
  const getMedia = async (uri: string): Promise<Buffer | null> => {
    const normalized = uri.replace(/^\/+/, "");
    const filename = uri.split("/").pop() ?? "";

    const ref =
      mediaEntries.get(normalized) ??
      mediaEntries.get(uri) ??
      mediaEntries.get(filename);

    if (!ref) return null;
    return ref.entry.buffer();
  };

  await runImportJob({ jobId, userId, parsedPosts: allPosts, getMedia });
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "process/route|error" | head -20`
Expected: No errors related to process/route.ts

- [ ] **Step 3: Commit**

```bash
git add src/app/api/import/process/route.ts
git commit -m "feat: add multi-ZIP import processing endpoint"
```

---

### Task 2: Update the import page UI for multi-file upload

**Files:**
- Modify: `src/app/(dashboard)/import/page.tsx`

Changes:
1. Dropzone accepts multiple files (`maxFiles` removed)
2. On drop, upload each file sequentially to Vercel Blob with per-file progress
3. Once all uploads complete, POST the Blob URLs to `/api/import/process`
4. Show upload stage progress (uploading files) then import stage progress (existing polling)

- [ ] **Step 1: Update imports and add upload state**

At the top of `src/app/(dashboard)/import/page.tsx`, add the `upload` import:

```tsx
import { upload } from "@vercel/blob/client";
```

Add new state variables after the existing state declarations inside the component:

```tsx
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [fileProgress, setFileProgress] = useState<{ current: number; total: number; name: string } | null>(null);
```

- [ ] **Step 2: Replace the `onDrop` callback**

Replace the existing `onDrop` callback with this version that handles multiple ZIPs:

```tsx
  const onDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploadError("");

    // Single JSON file — use the existing direct upload endpoint
    if (files.length === 1 && files[0].name.endsWith(".json")) {
      const form = new FormData();
      form.append("file", files[0]);
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      const newJob: ImportJob = { id: data.jobId, status: "PENDING", filename: files[0].name, source: "UPLOAD", totalPosts: 0, importedPosts: 0, skippedPosts: 0, errorLog: null, startedAt: null, completedAt: null };
      setActiveJob(newJob);
      sessionStorage.setItem("activeImportJob", JSON.stringify(newJob));
      return;
    }

    // Single small ZIP — use existing direct upload endpoint
    if (files.length === 1 && files[0].size < 4 * 1024 * 1024) {
      const form = new FormData();
      form.append("file", files[0]);
      const res = await fetch("/api/import/upload", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed");
        return;
      }
      const newJob: ImportJob = { id: data.jobId, status: "PENDING", filename: files[0].name, source: "UPLOAD", totalPosts: 0, importedPosts: 0, skippedPosts: 0, errorLog: null, startedAt: null, completedAt: null };
      setActiveJob(newJob);
      sessionStorage.setItem("activeImportJob", JSON.stringify(newJob));
      return;
    }

    // Multiple files or large ZIP — upload to Blob, then process
    setUploadingFiles(true);
    const blobUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        setFileProgress({ current: i + 1, total: files.length, name: files[i].name });
        const blob = await upload(files[i].name, files[i], {
          access: "public",
          handleUploadUrl: "/api/blob",
        });
        blobUrls.push(blob.url);
      }

      setFileProgress(null);

      // Trigger processing
      const res = await fetch("/api/import/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrls }),
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error ?? "Processing failed");
        return;
      }

      const label = files.length === 1 ? files[0].name : `${files.length} ZIP files`;
      const newJob: ImportJob = { id: data.jobId, status: "PENDING", filename: label, source: "UPLOAD", totalPosts: 0, importedPosts: 0, skippedPosts: 0, errorLog: null, startedAt: null, completedAt: null };
      setActiveJob(newJob);
      sessionStorage.setItem("activeImportJob", JSON.stringify(newJob));
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploadingFiles(false);
      setFileProgress(null);
    }
  }, []);
```

- [ ] **Step 3: Update dropzone config to accept multiple files**

Replace the existing `useDropzone` call:

```tsx
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
      "application/json": [".json"],
    },
    disabled: uploadingFiles,
  });
```

Note: `maxFiles: 1` is removed entirely.

- [ ] **Step 4: Update dropzone UI text and add upload progress**

Replace the dropzone content (the inner `<>...</>` inside the `!isDragActive` branch) with:

```tsx
              <>
                <p className="text-sm font-medium text-gray-700">
                  Drag & drop your Facebook export
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Supports multiple .zip files (Meta split exports) or a single .json
                </p>
                <Button variant="outline" size="sm" className="mt-3" disabled={uploadingFiles}>
                  Browse files
                </Button>
              </>
```

Add the upload progress indicator right after the closing `</div>` of the dropzone (before the `{uploadError && ...}` block):

```tsx
          {uploadingFiles && fileProgress && (
            <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
              <div className="text-sm">
                <p className="font-medium text-blue-800">
                  Uploading file {fileProgress.current} of {fileProgress.total}
                </p>
                <p className="text-blue-600 text-xs">{fileProgress.name}</p>
              </div>
            </div>
          )}
```

- [ ] **Step 5: Verify the page compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -E "import/page|error" | head -20`
Expected: No errors related to import/page.tsx

- [ ] **Step 6: Commit**

```bash
git add src/app/(dashboard)/import/page.tsx
git commit -m "feat: multi-ZIP upload UI with Blob staging and progress"
```

---

### Task 3: Manual testing

**Files:** None (testing only)

- [ ] **Step 1: Start dev server**

Run: `npm run dev`

- [ ] **Step 2: Test single JSON upload still works**

Navigate to `/import`, drop a single `.json` file. Verify it uses the existing direct upload path (no Blob staging) and the import completes normally.

- [ ] **Step 3: Test multi-ZIP upload**

Navigate to `/import`, select all 10 Facebook export ZIPs. Verify:
- Upload progress shows "Uploading file 1 of 10", "2 of 10", etc.
- After all uploads complete, import job starts and progress bar appears
- Posts are imported with media attached (not just text)
- Dropzone is disabled during upload

- [ ] **Step 4: Commit any fixes**

If any issues found during testing, fix and commit.
