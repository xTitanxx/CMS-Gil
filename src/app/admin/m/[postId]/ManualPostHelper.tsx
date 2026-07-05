"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { SiFacebook } from "react-icons/si";
import { copyTextToClipboard } from "@/lib/client/shareToFacebook";

interface Media {
  id: string;
  mimeType: string;
  url: string | null;
}

interface Props {
  postId: string;
  body: string;
  originalDate: string;
  platformUrl: string | null;
  media: Media[];
}

type Destination = {
  id: string;
  label: string;
  type: "feed" | "group" | "other";
  href?: string;
  done: boolean;
};

type StoredDestination = Omit<Destination, "done">;

const STARTER_GROUPS: StoredDestination[] = [
  { id: "feed", label: "Personal feed", type: "feed", href: "https://www.facebook.com/" },
  { id: "group-theater", label: "Theatre group", type: "group", href: "https://www.facebook.com/groups/" },
  { id: "group-friends", label: "Friends group", type: "group", href: "https://www.facebook.com/groups/" },
];

// Renames + added groups live in localStorage so the checklist Gil curates
// once survives every reload. `done` is intentionally NOT persisted — it's
// per-posting-session state that should start fresh for each post.
const DESTINATIONS_KEY = "manual-fb-destinations-v1";

// Ceiling for pulling media into memory to hand to the OS share sheet. Above
// this we skip the native "Save to Photos" path and fall back to a browser
// download rather than block the page prefetching a huge video.
const MAX_PREFETCH_BYTES = 80 * 1024 * 1024;

function sanitizeReturnTo(value: string | null): string {
  if (!value) return "/admin/manual-fb";
  if (!value.startsWith("/") || value.startsWith("//")) return "/admin/manual-fb";
  return value;
}

function mediaDownloadUrl(id: string): string {
  return `/api/media/${encodeURIComponent(id)}/download`;
}

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    return u.pathname.split("/").pop() || fallback;
  } catch {
    return fallback;
  }
}

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Facebook has no public web URL that pops the composer, but its app answers
// the `fb://composer` scheme and drops you straight into a fresh post draft.
// On desktop (no app) we can only open facebook.com — the composer is one tap
// from there.
function openFacebookComposer() {
  if (isMobileDevice()) {
    window.location.href = "fb://composer";
  } else {
    window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
  }
}

type NavWithShare = Navigator & {
  share?: (data: { text?: string; title?: string; files?: File[] }) => Promise<void>;
  canShare?: (data: { files?: File[] }) => boolean;
};

export function ManualPostHelper({ postId, body, originalDate, platformUrl, media }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams?.get("from") ?? null);

  const [copied, setCopied] = useState(false);

  const [preparing, setPreparing] = useState(true);
  const [preparedFiles, setPreparedFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [destinations, setDestinations] = useState<Destination[]>(
    STARTER_GROUPS.map((destination) => ({ ...destination, done: false })),
  );
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [otherName, setOtherName] = useState("");

  const [postingUrl, setPostingUrl] = useState("");
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  const copiedOnceRef = useRef(false);
  const destinationsLoadedRef = useRef(false);

  const mediaItems = useMemo(() => media.filter((item) => item.url), [media]);
  const mediaCount = mediaItems.length;
  const completedCount = destinations.filter((destination) => destination.done).length;
  const fresh = searchParams?.get("fresh") === "1";
  const dateLabel = useMemo(
    () =>
      new Date(originalDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [originalDate],
  );

  const hasMedia = mediaCount > 0;
  const saveStepNo = 1;
  const openStepNo = hasMedia ? 2 : 1;
  const doneStepNo = hasMedia ? 3 : 2;

  async function copyCaption() {
    if (!body.trim()) return false;
    const ok = await copyTextToClipboard(body);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
    return ok;
  }

  // Auto-copy the caption on mount so it's already on the clipboard when the
  // user reaches the Facebook composer.
  useEffect(() => {
    if (copiedOnceRef.current || !body.trim()) return;
    copiedOnceRef.current = true;
    void copyCaption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  // Load the curated destinations list (renames + added groups) from
  // localStorage, resetting each row's `done` flag for this posting session.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DESTINATIONS_KEY);
      if (raw) {
        const parsed: StoredDestination[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setDestinations(parsed.map((destination) => ({ ...destination, done: false })));
        }
      }
    } catch {
      // Corrupt/absent storage — keep the starter defaults.
    } finally {
      destinationsLoadedRef.current = true;
    }
  }, []);

  // Persist destination edits (but never `done`) once the initial load has run,
  // so a first render doesn't clobber saved data with the defaults.
  useEffect(() => {
    if (!destinationsLoadedRef.current) return;
    try {
      const toStore: StoredDestination[] = destinations.map((destination) => ({
        id: destination.id,
        label: destination.label,
        type: destination.type,
        href: destination.href,
      }));
      window.localStorage.setItem(DESTINATIONS_KEY, JSON.stringify(toStore));
    } catch {
      // Storage full/blocked — renames just won't persist, not fatal.
    }
  }, [destinations]);

  // Pull media into memory on mount. navigator.share() silently drops files if
  // any network request is awaited between the tap and the call, so the ONLY
  // reliable way to offer iOS "Save to Photos" is to have the File objects
  // ready before the user taps Save.
  useEffect(() => {
    let cancelled = false;
    if (mediaCount === 0) {
      setPreparing(false);
      return;
    }
    void (async () => {
      const files: File[] = [];
      let total = 0;
      try {
        for (let index = 0; index < mediaItems.length; index++) {
          const item = mediaItems[index];
          const res = await fetch(mediaDownloadUrl(item.id));
          if (!res.ok) continue;
          const blob = await res.blob();
          total += blob.size;
          if (total > MAX_PREFETCH_BYTES) {
            // Too heavy for a reliable share sheet — leave preparedFiles empty
            // so Save falls back to a browser download.
            files.length = 0;
            break;
          }
          const ext = item.mimeType.split("/")[1] ?? "bin";
          const name = filenameFromUrl(item.url!, `gil-facebook-${postId}-${index + 1}.${ext}`);
          files.push(new File([blob], name, { type: item.mimeType }));
        }
      } catch {
        files.length = 0;
      }
      if (!cancelled) {
        setPreparedFiles(files);
        setPreparing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaCount]);

  async function downloadFallback() {
    setSaving(true);
    setSaveError(null);
    try {
      for (let index = 0; index < mediaItems.length; index++) {
        const item = mediaItems[index];
        const res = await fetch(mediaDownloadUrl(item.id));
        if (!res.ok) throw new Error(`download ${res.status}`);
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const ext = item.mimeType.split("/")[1] ?? "bin";
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filenameFromUrl(item.url!, `gil-facebook-${postId}-${index + 1}.${ext}`);
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
      setSaved(true);
    } catch {
      setSaveError("Couldn't save the media. Open the post page and save it there.");
    } finally {
      setSaving(false);
    }
  }

  // NOTE: no `await` may run before navigator.share() — preparedFiles is
  // already in memory, so the share sheet fires inside the tap's activation
  // and iOS offers "Save Image / Save Video" straight to the camera roll.
  async function handleSaveMedia() {
    if (mediaCount === 0) return;
    setSaveError(null);
    const nav = navigator as NavWithShare;
    if (
      preparedFiles.length > 0 &&
      nav.share &&
      nav.canShare &&
      nav.canShare({ files: preparedFiles })
    ) {
      try {
        await nav.share({ files: preparedFiles });
        setSaved(true);
      } catch (err) {
        // User cancelled the sheet — that's not an error, just leave it unsaved.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSaveError("Sharing didn't complete. Try again or use the post page.");
      }
      return;
    }
    await downloadFallback();
  }

  function openDestination(destination: Destination) {
    void copyCaption();
    if (destination.type === "feed") {
      openFacebookComposer();
    } else {
      window.open(destination.href || "https://www.facebook.com/", "_blank", "noopener,noreferrer");
    }
  }

  function toggleDestination(id: string) {
    setDestinations((current) =>
      current.map((destination) =>
        destination.id === id ? { ...destination, done: !destination.done } : destination,
      ),
    );
  }

  function startRename(destination: Destination) {
    setEditingId(destination.id);
    setEditingValue(destination.label);
  }

  function commitRename() {
    const label = editingValue.trim();
    if (editingId && label) {
      setDestinations((current) =>
        current.map((destination) =>
          destination.id === editingId ? { ...destination, label } : destination,
        ),
      );
    }
    setEditingId(null);
    setEditingValue("");
  }

  function addOtherDestination() {
    const label = otherName.trim();
    if (!label) return;
    setDestinations((current) => [
      ...current,
      {
        id: `other-${Date.now()}`,
        label,
        type: "other",
        href: "https://www.facebook.com/groups/",
        done: false,
      },
    ]);
    setOtherName("");
  }

  function removeDestination(id: string) {
    setDestinations((current) => current.filter((destination) => destination.id !== id));
  }

  async function handleMarkPosted() {
    if (marking || marked) return;
    setMarking(true);
    setMarkError(null);
    try {
      const trimmedUrl = postingUrl.trim();
      const payload: Record<string, unknown> = { platform: "FACEBOOK" };
      if (trimmedUrl) payload.platformUrl = trimmedUrl;
      const res = await fetch(`/api/posts/${postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkError(data?.error ?? "Could not mark this post as posted.");
        return;
      }
      setMarked(true);
      window.setTimeout(() => router.push(returnTo), 700);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="-m-4 min-h-[calc(100vh-3.5rem)] bg-[#f7f7f4] text-gray-950 md:-m-8">
      <header
        className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f7f4]/95 px-4 pb-3 pt-3 md:px-8"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.75rem)" }}
      >
        <div className="mx-auto flex max-w-md items-center gap-3">
          <Link
            href={returnTo}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-700 shadow-sm ring-1 ring-black/5 active:scale-95"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-[#1877F2]">
              <SiFacebook className="h-3.5 w-3.5" />
              Post to Facebook
            </div>
            <p className="truncate text-xs text-gray-500">{fresh ? "Saved just now" : dateLabel}</p>
          </div>
          {platformUrl && (
            <a
              href={platformUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-600 shadow-sm ring-1 ring-black/5"
              aria-label="Open original"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-md space-y-3 px-4 py-4 pb-28">
        {/* Caption — auto-copied, shown for reassurance, re-copyable. */}
        <section className="rounded-[14px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="h-3.5 w-3.5" />
              Caption copied
            </span>
            <button
              type="button"
              onClick={() => void copyCaption()}
              className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-800 active:bg-gray-200"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
            {body || "No caption."}
          </p>
        </section>

        {/* Step 1 — Save photos to the camera roll. */}
        {hasMedia && (
          <StepCard n={saveStepNo} title="Save the photos" done={saved}>
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {mediaItems.slice(0, 4).map((item) => (
                <div key={item.id} className="aspect-square overflow-hidden rounded-[8px] bg-black">
                  {item.mimeType.startsWith("video/") ? (
                    <video src={item.url ?? ""} muted playsInline className="h-full w-full object-cover" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url ?? ""} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => void handleSaveMedia()}
              disabled={preparing || saving}
              className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#1877F2] px-4 text-base font-semibold text-white disabled:opacity-50 active:scale-[0.99]"
            >
              {preparing || saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : saved ? (
                <Check className="h-5 w-5" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              {preparing
                ? "Getting photos ready…"
                : saving
                  ? "Saving…"
                  : saved
                    ? "Saved to your phone"
                    : mediaCount === 1
                      ? "Save to Photos"
                      : `Save ${mediaCount} to Photos`}
            </button>
            {saveError && (
              <p className="mt-2 rounded-[8px] bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
                {saveError}
              </p>
            )}
          </StepCard>
        )}

        {/* Step 2 — Open the Facebook composer. */}
        <StepCard n={openStepNo} title="Open Facebook">
          <button
            type="button"
            onClick={() => {
              void copyCaption();
              openFacebookComposer();
            }}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-[#1877F2] px-4 text-base font-semibold text-white active:scale-[0.99]"
          >
            <SiFacebook className="h-5 w-5" />
            Open new post
          </button>
          <p className="mt-2 text-xs leading-snug text-gray-500">
            Opens a fresh post. Paste the caption and add the photos you just saved.
          </p>
        </StepCard>

        {/* Step 3 — Confirm posted. */}
        <StepCard n={doneStepNo} title="Mark as posted" done={marked}>
          <input
            type="url"
            inputMode="url"
            value={postingUrl}
            onChange={(e) => setPostingUrl(e.target.value)}
            placeholder="Optional: paste the Facebook post link"
            disabled={marked}
            className="mb-3 min-h-11 w-full rounded-[10px] border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1877F2] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void handleMarkPosted()}
            disabled={marking || marked}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-emerald-600 px-4 text-base font-semibold text-white disabled:opacity-60 active:scale-[0.99]"
          >
            {marking ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            {marked ? "All done" : "I posted it"}
          </button>
          {markError && <p className="mt-2 text-xs text-red-700">{markError}</p>}
        </StepCard>

        {/* Optional — post to multiple groups, with rename. Tucked away. */}
        <section className="rounded-[14px] bg-white p-2 shadow-sm ring-1 ring-black/5">
          <button
            type="button"
            onClick={() => setGroupsOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[10px] px-2 text-left active:bg-gray-50"
          >
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Post to groups</span>
              <span className="block truncate text-xs text-gray-500">
                {completedCount}/{destinations.length} marked · rename or add your own
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 shrink-0 transition ${groupsOpen ? "rotate-180" : ""}`} />
          </button>

          {groupsOpen && (
            <div className="mt-2 space-y-2 border-t border-gray-100 px-1 pt-3">
              {destinations.map((destination) => (
                <div
                  key={destination.id}
                  className={`rounded-[10px] border p-2 transition ${
                    destination.done ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleDestination(destination.id)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${
                        destination.done
                          ? "border-emerald-600 bg-emerald-600 text-white"
                          : "border-gray-300 bg-white text-transparent"
                      }`}
                      aria-label={destination.done ? "Mark not posted" : "Mark posted"}
                    >
                      <Check className="h-4 w-4" />
                    </button>

                    {editingId === destination.id ? (
                      <input
                        autoFocus
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditingValue("");
                          }
                        }}
                        className="min-h-9 min-w-0 flex-1 rounded-[8px] border border-[#1877F2] bg-white px-2 text-sm outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => startRename(destination)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        aria-label={`Rename ${destination.label}`}
                      >
                        <span className="truncate text-sm font-semibold text-gray-950">
                          {destination.label}
                        </span>
                        <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => openDestination(destination)}
                      className="shrink-0 rounded-[8px] bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 active:bg-gray-200"
                    >
                      Open
                    </button>
                    {destination.type === "other" && (
                      <button
                        type="button"
                        onClick={() => removeDestination(destination.id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400"
                        aria-label="Remove group"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}

              <div className="flex gap-2 pt-1">
                <input
                  value={otherName}
                  onChange={(e) => setOtherName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addOtherDestination();
                  }}
                  placeholder="Add a group"
                  className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1877F2]"
                />
                <button
                  type="button"
                  onClick={addOtherDestination}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-gray-950 text-white"
                  aria-label="Add group"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StepCard({
  n,
  title,
  done,
  children,
}: {
  n: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[14px] bg-white p-4 shadow-sm ring-1 ring-black/5">
      <div className="mb-3 flex items-center gap-3">
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
            done ? "bg-emerald-600 text-white" : "bg-gray-950 text-white"
          }`}
        >
          {done ? <Check className="h-4 w-4" /> : n}
        </div>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  );
}
