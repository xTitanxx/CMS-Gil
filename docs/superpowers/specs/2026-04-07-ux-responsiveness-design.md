# UX Responsiveness Design
**Date:** 2026-04-07

## Problem

The app feels unresponsive in three ways:
1. Browser-native `alert()` and `confirm()` dialogs interrupt the experience
2. No loading indicators — async actions freeze silently until done
3. Import progress disappears after a few seconds instead of persisting

## Approach

Two small shared hooks cover every case. No global state, no new dependencies, no context providers.

---

## Hooks

### `src/hooks/useAsync.ts`

Wraps any async call and tracks `idle | loading | success | error` status plus an optional result message.

```ts
const { status, message, run } = useAsync();
// In handler:
run(() => fetch(...), "Saved successfully");
// In JSX:
{status === 'loading' && <Spinner />}
{status === 'success' && <p>{message}</p>}
{status === 'error' && <p className="text-red-600">{message}</p>}
```

- `run(fn, successMessage?)` — executes fn, sets loading, sets success/error on settle
- `isLoading` — boolean shorthand
- Errors are caught internally and surfaced as `status: 'error'` with `message` set to the error string
- No auto-dismiss — message stays until the component unmounts or the hook is re-run

### `src/hooks/useConfirm.ts`

Two-tap pattern for destructive actions.

```ts
const { confirming, trigger } = useConfirm(onConfirm);
// In JSX:
<button onClick={trigger}>
  {confirming ? "Are you sure?" : "Delete"}
</button>
```

- First tap: sets `confirming: true`, button label changes to "Are you sure?"
- Second tap within 3 seconds: calls `onConfirm()`
- No second tap: resets after 3 seconds automatically
- Accepts the confirm callback at hook construction time

---

## Changes by Page

### `src/app/(dashboard)/posts/page.tsx`

| Element | Before | After |
|---|---|---|
| Row delete button | `confirm()` dialog | Two-tap confirm → spinner → row disappears |
| Bulk delete button | `confirm()` dialog | Two-tap confirm → spinner → "Deleted N posts" in action bar |
| Page fetch (search/sort/pagination) | Silent freeze | Spinner overlay on the post list while loading |

### `src/app/(dashboard)/posts/[id]/PostInteractions.tsx`

| Element | Before | After |
|---|---|---|
| Delete post button | `confirm()` dialog | Two-tap confirm → spinner → redirect on success |

### `src/app/(dashboard)/import/page.tsx`

| Element | Before | After |
|---|---|---|
| "Sync Now" button | Browser `alert()` | Spinner on button → inline result message below, persists until navigation |
| "Reset sync history" button | Browser `alert()` | Two-tap confirm → spinner → inline result message |
| Import job progress card | Disappears after ~seconds | Persists until user navigates away (store jobId in sessionStorage, rehydrate on mount) |

### `src/app/(dashboard)/connections/page.tsx`

- Connect/disconnect/save actions: spinner on button → inline success or error message

### `src/app/(dashboard)/scheduled/DayPanel.tsx`

- Save/submit actions: spinner on button → inline result

### All pages — initial load

Every dashboard page that fetches on mount currently renders blank during the fetch. Each page gets a skeleton or centered spinner shown during `loading: true` state.

---

## UI Conventions

**Spinner:** Use the existing `RefreshCw` lucide icon with `animate-spin`, or a simple inline SVG spinner. No new component needed.

**Result message placement:** Immediately below or beside the triggering button, in the same card/section. Never floats or overlays.

**Two-tap button label:** First state uses normal label ("Delete"). Confirming state uses "Are you sure?" in a warning color (amber or red). No icon change needed.

**Error messages:** Red text, same placement as success messages.

---

## Import Progress Persistence

The active job state in `import/page.tsx` is currently held in component state and lost on navigation. Fix:
- On job creation, write `{ jobId, filename }` to `sessionStorage`
- On mount, check `sessionStorage` and rehydrate — resume polling if job is still active
- On job completion or failure, clear `sessionStorage`
- The progress card stays visible until the user navigates away from the import page

---

## Out of Scope

- Toast notifications
- Global notification context or provider
- Any visual redesign beyond the spinner/message pattern
- New dependencies
