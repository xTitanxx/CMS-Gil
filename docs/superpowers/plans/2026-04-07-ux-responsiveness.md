# UX Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all browser `alert()`/`confirm()` dialogs with in-place spinners and result messages, and make every async action visually responsive.

**Architecture:** Two shared hooks (`useAsync`, `useConfirm`) in `src/hooks/` cover all cases. Components use these hooks with local state — no global context. Import job progress is persisted via `sessionStorage` so it survives navigation within the session.

**Tech Stack:** React hooks, Tailwind CSS, lucide-react (`RefreshCw` for spinners), `sessionStorage` for import persistence.

**Pages in scope:**
- Dashboard (`page.tsx`) — server component, no client loading state needed. Skip.
- Chat (`page.tsx`) — starts empty, no mount fetch. Skip.
- `posts/page.tsx` — Tasks 5
- `posts/[id]/PostInteractions.tsx` — Task 4
- `import/page.tsx` — Task 6
- `connections/page.tsx` — Task 7
- `scheduled/ContentCalendar.tsx` — Task 8

---

### Task 1: Create `useAsync` hook

**Files:**
- Create: `src/hooks/useAsync.ts`

- [ ] **Step 1: Create the file**

```ts
// src/hooks/useAsync.ts
import { useState, useCallback } from "react";

type Status = "idle" | "loading" | "success" | "error";

export interface AsyncState {
  status: Status;
  message: string;
  isLoading: boolean;
}

export function useAsync<T = unknown>(): AsyncState & {
  run: (fn: () => Promise<T>, successMessage?: string) => Promise<T | undefined>;
  reset: () => void;
} {
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const run = useCallback(
    async (fn: () => Promise<T>, successMessage = "Done"): Promise<T | undefined> => {
      setStatus("loading");
      setMessage("");
      try {
        const result = await fn();
        setStatus("success");
        setMessage(successMessage);
        return result;
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : String(err));
        return undefined;
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage("");
  }, []);

  return { status, message, isLoading: status === "loading", run, reset };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "useAsync" | head -5
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useAsync.ts
git commit -m "feat: add useAsync hook"
```

---

### Task 2: Create `useConfirm` hook

**Files:**
- Create: `src/hooks/useConfirm.ts`

- [ ] **Step 1: Create the file**

```ts
// src/hooks/useConfirm.ts
import { useState, useCallback, useRef } from "react";

export function useConfirm(onConfirm: () => void): {
  confirming: boolean;
  trigger: () => void;
} {
  const [confirming, setConfirming] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (confirming) {
      if (timerRef.current) clearTimeout(timerRef.current);
      setConfirming(false);
      onConfirm();
    } else {
      setConfirming(true);
      timerRef.current = setTimeout(() => setConfirming(false), 3000);
    }
  }, [confirming, onConfirm]);

  return { confirming, trigger };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "useConfirm" | head -5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useConfirm.ts
git commit -m "feat: add useConfirm two-tap hook"
```

---

### Task 3: Create `Spinner` component

**Files:**
- Create: `src/components/ui/spinner.tsx`

- [ ] **Step 1: Create the file**

```tsx
// src/components/ui/spinner.tsx
import { RefreshCw } from "lucide-react";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <RefreshCw className={`animate-spin ${className}`} />;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/spinner.tsx
git commit -m "feat: add Spinner component"
```

---

### Task 4: Update `PostInteractions.tsx`

**Files:**
- Modify: `src/app/(dashboard)/posts/[id]/PostInteractions.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
// src/app/(dashboard)/posts/[id]/PostInteractions.tsx
"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Trash2, RefreshCw } from "lucide-react";
import { PublishPanel } from "@/components/posts/PublishPanel";
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";

export function DeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const { isLoading, run } = useAsync();

  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    router.push("/posts");
  }, [postId, run, router]);

  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <Button
      variant="ghost"
      size="sm"
      className={
        confirming
          ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50"
          : "text-red-500 hover:text-red-700 hover:bg-red-50"
      }
      disabled={isLoading}
      onClick={trigger}
    >
      {isLoading ? <Spinner /> : <Trash2 className="h-4 w-4" />}
      {isLoading ? "Deleting..." : confirming ? "Are you sure?" : "Delete"}
    </Button>
  );
}

export function ReanalyzeButton({ postId }: { postId: string }) {
  const router = useRouter();
  const { isLoading, status, message, run } = useAsync();

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={isLoading}
        onClick={() =>
          run(async () => {
            await fetch(`/api/posts/${postId}/analyze`, { method: "POST" });
            router.refresh();
          }, "Re-analysis complete")
        }
      >
        {isLoading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
        {isLoading ? "Analyzing..." : "Re-analyze"}
      </Button>
      {status === "success" && (
        <p className="text-xs text-green-600">{message}</p>
      )}
      {status === "error" && (
        <p className="text-xs text-red-600">{message}</p>
      )}
    </div>
  );
}

export function PublishPanelWithRefresh({ postId }: { postId: string }) {
  const router = useRouter();
  return <PublishPanel postId={postId} onPublished={() => router.refresh()} />;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "PostInteractions" | head -5
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/posts/[id]/PostInteractions.tsx
git commit -m "feat: two-tap confirm and spinner on post detail delete/reanalyze"
```

---

### Task 5: Update `posts/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/posts/page.tsx`

- [ ] **Step 1: Add imports**

Add to the existing import block at the top:

```tsx
import { useCallback } from "react";   // add to existing react import
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
```

(`useCallback` and `useRef` may already be imported — just add any that are missing.)

- [ ] **Step 2: Add `bulkDelete` async state alongside other state declarations**

Add after the existing state declarations (near `bulkDeleting`):

```tsx
const bulkDelete = useAsync();
const [lastBulkCount, setLastBulkCount] = useState(0);
```

Remove the existing `const [bulkDeleting, setBulkDeleting] = useState(false);` line — `bulkDelete.isLoading` replaces it.

- [ ] **Step 3: Replace `handleBulkDelete`**

```tsx
const handleBulkDelete = useCallback(async () => {
  const count = selectAllMode ? total : selectedIds.size;
  setLastBulkCount(count);
  await bulkDelete.run(async () => {
    const res = await fetch("/api/posts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        selectAllMode
          ? { all: true, search }
          : { ids: [...selectedIds] }
      ),
    });
    if (!res.ok) throw new Error("Delete failed");
  }, `Deleted ${count} post${count === 1 ? "" : "s"}`);
  fetchPosts();
}, [bulkDelete, selectAllMode, total, selectedIds, search, fetchPosts]);
```

- [ ] **Step 4: Add `useConfirm` for bulk delete**

Add after the `handleBulkDelete` function:

```tsx
const { confirming: bulkConfirming, trigger: triggerBulkDelete } = useConfirm(handleBulkDelete);
```

- [ ] **Step 5: Update bulk delete button JSX**

Find the bulk delete `<Button>` in the action bar and replace it:

```tsx
<Button
  size="sm"
  variant={bulkConfirming ? "outline" : "destructive"}
  disabled={bulkDelete.isLoading}
  onClick={triggerBulkDelete}
  className={bulkConfirming ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""}
>
  {bulkDelete.isLoading ? <Spinner /> : <Trash2 className="h-4 w-4" />}
  {bulkDelete.isLoading
    ? "Deleting..."
    : bulkConfirming
    ? "Are you sure?"
    : "Delete selected"}
</Button>
```

Add inline result message directly below the action bar `<div>`:

```tsx
{bulkDelete.status === "success" && (
  <p className="text-sm text-green-700 px-1">{bulkDelete.message}</p>
)}
{bulkDelete.status === "error" && (
  <p className="text-sm text-red-600 px-1">{bulkDelete.message}</p>
)}
```

- [ ] **Step 6: Add `RowDeleteButton` component**

Add this function before the `PostsPage` default export:

```tsx
function RowDeleteButton({
  postId,
  onDeleted,
}: {
  postId: string;
  onDeleted: () => void;
}) {
  const { isLoading, run } = useAsync();
  const handleDelete = useCallback(async () => {
    await run(async () => {
      const res = await fetch(`/api/posts/${postId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
    });
    onDeleted();
  }, [postId, run, onDeleted]);
  const { confirming, trigger } = useConfirm(handleDelete);

  return (
    <button
      className={`ml-2 flex-shrink-0 p-1 transition-colors ${
        confirming
          ? "text-amber-500"
          : "text-gray-300 hover:text-red-500"
      }`}
      onClick={(e) => {
        e.preventDefault();
        trigger();
      }}
      title={confirming ? "Click again to confirm" : "Delete post"}
    >
      {isLoading ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  );
}
```

- [ ] **Step 7: Replace the inline delete button in each row**

Find the row-level `<button>` with the `confirm()` call and replace it:

```tsx
// Remove this:
<button
  className="ml-2 flex-shrink-0 p-1 text-gray-300 hover:text-red-500 transition-colors"
  onClick={async (e) => {
    e.preventDefault();
    if (!confirm("Delete this post?")) return;
    await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
    fetchPosts();
  }}
>
  <Trash2 className="h-4 w-4" />
</button>

// Add this:
<RowDeleteButton postId={post.id} onDeleted={fetchPosts} />
```

- [ ] **Step 8: Add spinner overlay to the post list while loading**

Find the section that renders the post list:

```tsx
) : (
  <div className="space-y-2">
```

Replace with:

```tsx
) : (
  <div className="relative space-y-2">
    {loading && (
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60">
        <Spinner className="h-6 w-6 text-gray-400" />
      </div>
    )}
```

- [ ] **Step 9: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "posts/page" | head -5
```

Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add src/app/(dashboard)/posts/page.tsx
git commit -m "feat: two-tap confirm, spinners, and loading overlay in posts list"
```

---

### Task 6: Update `import/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/import/page.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { useAsync } from "@/hooks/useAsync";
import { useConfirm } from "@/hooks/useConfirm";
import { Spinner } from "@/components/ui/spinner";
```

- [ ] **Step 2: Replace drive sync state**

Remove these lines:
```tsx
const [driveSyncing, setDriveSyncing] = useState(false);
const [driveNotice, setDriveNotice] = useState<{ type: "success" | "info"; message: string } | null>(null);
const showNotice = (type: "success" | "info", message: string) => { ... };
```

Add in their place:
```tsx
const syncNow = useAsync();
const resetHistory = useAsync();
const [lastSyncCount, setLastSyncCount] = useState<number | null>(null);
```

- [ ] **Step 3: Replace `resetDriveSyncHistory`**

```tsx
const resetDriveSyncHistory = async () => {
  await resetHistory.run(async () => {
    const res = await fetch("/api/drive/sync", { method: "DELETE" });
    if (!res.ok) throw new Error("Reset failed");
    const data = await res.json();
    return data;
  }, "Import history cleared. You can now sync again.");
};
```

- [ ] **Step 4: Replace `triggerDriveSync`**

```tsx
const triggerDriveSync = async () => {
  await syncNow.run(async () => {
    const res = await fetch("/api/drive/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) throw new Error("Sync failed");
    const data: { jobsCreated: number } = await res.json();
    setLastSyncCount(data.jobsCreated ?? 0);
  }, "sync_done");
};
```

- [ ] **Step 5: Wire `useConfirm` to reset button**

Add after the two `useAsync` declarations:

```tsx
const { confirming: resetConfirming, trigger: triggerReset } = useConfirm(resetDriveSyncHistory);
```

- [ ] **Step 6: Replace Sync Now button in JSX**

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={triggerDriveSync}
  disabled={syncNow.isLoading}
>
  {syncNow.isLoading ? <Spinner /> : <RefreshCw className="h-4 w-4" />}
  {syncNow.isLoading ? "Syncing..." : "Sync Now"}
</Button>
```

- [ ] **Step 7: Replace Reset sync history button in JSX**

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={triggerReset}
  disabled={resetHistory.isLoading}
  className={resetConfirming ? "border-amber-400 text-amber-700 hover:bg-amber-50" : ""}
>
  {resetHistory.isLoading ? <Spinner /> : null}
  {resetHistory.isLoading
    ? "Resetting..."
    : resetConfirming
    ? "Are you sure?"
    : "Reset sync history"}
</Button>
```

- [ ] **Step 8: Replace the `driveNotice` banner in JSX with inline messages**

Remove the existing `{driveNotice && (...)}` block. In its place, add these two message blocks (immediately above the `{driveError && ...}` line):

```tsx
{syncNow.status === "success" && (
  <div className="flex items-center gap-2 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">
    <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
    {lastSyncCount && lastSyncCount > 0
      ? `Sync started: ${lastSyncCount} job(s) queued for import.`
      : "Sync complete: no new files found."}
  </div>
)}
{syncNow.status === "error" && (
  <p className="text-sm text-red-600">{syncNow.message}</p>
)}
{resetHistory.status === "success" && (
  <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-800">
    <Info className="h-4 w-4 shrink-0 text-blue-500" />
    {resetHistory.message}
  </div>
)}
{resetHistory.status === "error" && (
  <p className="text-sm text-red-600">{resetHistory.message}</p>
)}
```

(`CheckCircle` and `Info` are already imported in the file.)

- [ ] **Step 9: Persist active import job to `sessionStorage`**

In the `onDrop` callback, after `setActiveJob(...)`, add:

```tsx
const newJob: ImportJob = {
  id: data.jobId,
  status: "PENDING",
  filename: file.name,
  source: "UPLOAD",
  totalPosts: 0,
  importedPosts: 0,
  skippedPosts: 0,
  errorLog: null,
  startedAt: null,
  completedAt: null,
};
setActiveJob(newJob);
sessionStorage.setItem("activeImportJob", JSON.stringify(newJob));
```

(Remove the old `setActiveJob({...})` line that was there before.)

- [ ] **Step 10: Update the polling `useEffect` to sync sessionStorage**

Inside the `setInterval` callback, after `setActiveJob(data)`, add:

```tsx
sessionStorage.setItem("activeImportJob", JSON.stringify(data));
if (data.status === "COMPLETED" || data.status === "FAILED") {
  clearInterval(interval);
  setPolling(false);
  sessionStorage.removeItem("activeImportJob");
}
```

Remove the existing `if (data.status === "COMPLETED" || data.status === "FAILED")` block that only calls `clearInterval` — the new block above replaces it.

- [ ] **Step 11: Add mount `useEffect` to rehydrate from `sessionStorage`**

Add this `useEffect` BEFORE the polling `useEffect`:

```tsx
useEffect(() => {
  const stored = sessionStorage.getItem("activeImportJob");
  if (!stored) return;
  try {
    const job = JSON.parse(stored) as ImportJob;
    if (job.status !== "COMPLETED" && job.status !== "FAILED") {
      setActiveJob(job);
    }
  } catch {
    sessionStorage.removeItem("activeImportJob");
  }
}, []);
```

- [ ] **Step 12: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "import/page" | head -5
```

Expected: no output.

- [ ] **Step 13: Commit**

```bash
git add src/app/(dashboard)/import/page.tsx
git commit -m "feat: in-place sync feedback and persistent import job state"
```

---

### Task 7: Update `connections/page.tsx`

**Files:**
- Modify: `src/app/(dashboard)/connections/page.tsx`

- [ ] **Step 1: Add import**

```tsx
import { Spinner } from "@/components/ui/spinner";
```

- [ ] **Step 2: Add loading spinner for initial page load**

The page has `const [loading, setLoading] = useState(true)`. The platform cards already show a skeleton badge while loading, but the whole content area still renders. Find the opening of the platform cards section and wrap the entire `<div className="space-y-4">` in a loading guard:

```tsx
{loading ? (
  <div className="flex items-center justify-center py-16">
    <Spinner className="h-6 w-6 text-gray-400" />
  </div>
) : (
  <div className="space-y-4">
    {PLATFORMS.map((platform) => { ... })}
  </div>
)}
```

- [ ] **Step 3: Update the Disconnect button to show a spinner**

Find the Disconnect `<Button>` (it currently checks `disconnecting === platform.id`). Replace its contents:

```tsx
<Button
  variant="outline"
  size="sm"
  disabled={disconnecting === platform.id}
  onClick={() => disconnect(platform.id)}
>
  {disconnecting === platform.id ? (
    <>
      <Spinner />
      Disconnecting...
    </>
  ) : (
    "Disconnect"
  )}
</Button>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "connections" | head -5
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/connections/page.tsx
git commit -m "feat: spinner on connections initial load and disconnect"
```

---

### Task 8: Update `ContentCalendar.tsx`

**Files:**
- Modify: `src/app/(dashboard)/scheduled/ContentCalendar.tsx`

- [ ] **Step 1: Add import**

```tsx
import { Spinner } from "@/components/ui/spinner";
```

- [ ] **Step 2: Add loading overlay to the calendar grid**

The calendar already has a `loading` state. Find the section that renders the calendar grid (contains `<MonthView>` or `<WeekView>`). Wrap it in a relative container with an overlay:

```tsx
<div className="relative">
  {loading && (
    <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/60">
      <Spinner className="h-6 w-6 text-gray-400" />
    </div>
  )}
  {view === "month" ? (
    <MonthView ... />
  ) : (
    <WeekView ... />
  )}
</div>
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep "ContentCalendar" | head -5
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/scheduled/ContentCalendar.tsx
git commit -m "feat: spinner overlay on calendar while loading"
```

---

### Task 9: Build and deploy

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, all routes listed, no TypeScript errors.

- [ ] **Step 2: Deploy**

```bash
vercel --prod --yes 2>&1
```

Expected: `"readyState": "READY"`.

- [ ] **Step 3: Smoke-test checklist**

- [ ] Posts page: click delete on a row — turns amber "Are you sure?", second click spins, row disappears
- [ ] Posts page: bulk select + delete — two-tap, spinner, "Deleted N posts" message appears inline
- [ ] Posts page: change sort or search — spinner overlay on list while results load
- [ ] Post detail: click Delete — amber confirm, spinner, redirects to /posts
- [ ] Post detail: click Re-analyze — spinner, "Re-analysis complete" appears below button
- [ ] Import: click Sync Now — spinner on button, result message appears inline and stays
- [ ] Import: click Reset sync history — amber confirm, spinner, message appears inline
- [ ] Import: upload a file, navigate away, come back — job progress card still shows
- [ ] Connections: click Disconnect — spinner + "Disconnecting..." while in flight
- [ ] Connections: hard-refresh page — spinner shows while loading, then cards appear
- [ ] Scheduled: navigate month/week — spinner overlay on calendar during fetch
