"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Plus,
  Share2,
  Smartphone,
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

const STARTER_GROUPS: Array<Pick<Destination, "id" | "label" | "type" | "href">> = [
  { id: "feed", label: "Personal feed", type: "feed", href: "https://www.facebook.com/" },
  { id: "group-theater", label: "Theatre group", type: "group", href: "https://www.facebook.com/groups/" },
  { id: "group-friends", label: "Friends group", type: "group", href: "https://www.facebook.com/groups/" },
];

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

function openFacebookHref(href?: string) {
  window.open(href || "https://www.facebook.com/", "_blank", "noopener,noreferrer");
}

export function ManualPostHelper({ postId, body, originalDate, platformUrl, media }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams?.get("from") ?? null);
  const [copied, setCopied] = useState(false);
  const [mediaSaved, setMediaSaved] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>(
    STARTER_GROUPS.map((destination) => ({ ...destination, done: false })),
  );
  const [otherName, setOtherName] = useState("");
  const [postingUrl, setPostingUrl] = useState("");
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const copiedOnceRef = useRef(false);

  const mediaCount = media.filter((item) => item.url).length;
  const completedCount = destinations.filter((destination) => destination.done).length;
  const allDestinationsDone = destinations.length > 0 && completedCount === destinations.length;
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

  useEffect(() => {
    if (copiedOnceRef.current || !body.trim()) return;
    copiedOnceRef.current = true;
    void copyCaption();
    // Clipboard copy is best-effort here; the compose page also copies during
    // the original Post tap, where mobile browsers are most permissive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  async function copyCaption() {
    if (!body.trim()) return false;
    const ok = await copyTextToClipboard(body);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    }
    return ok;
  }

  async function saveMedia(item: Media, index: number) {
    if (!item.url) return false;
    const res = await fetch(mediaDownloadUrl(item.id));
    if (!res.ok) throw new Error(`download ${res.status}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const ext = item.mimeType.split("/")[1] ?? "bin";
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filenameFromUrl(item.url, `gil-facebook-${postId}-${index + 1}.${ext}`);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  }

  async function handleSaveAllMedia() {
    if (mediaCount === 0) {
      setMediaSaved(true);
      return;
    }
    setSavingMedia(true);
    setMediaError(null);
    try {
      const downloadable = media.filter((item) => item.url);
      for (let index = 0; index < downloadable.length; index++) {
        await saveMedia(downloadable[index], index);
      }
      setMediaSaved(true);
    } catch {
      setMediaError("Could not save the media automatically. Open the media from the post page and save it there.");
    } finally {
      setSavingMedia(false);
    }
  }

  async function handleOpenDestination(destination: Destination) {
    await copyCaption();
    openFacebookHref(destination.href);
  }

  function toggleDestination(id: string) {
    setDestinations((current) =>
      current.map((destination) =>
        destination.id === id ? { ...destination, done: !destination.done } : destination,
      ),
    );
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

  async function handleNativeShare() {
    type NavWithShare = Navigator & {
      share?: (data: { title?: string; text?: string; files?: File[] }) => Promise<void>;
      canShare?: (data: { files?: File[] }) => boolean;
    };
    const nav = navigator as NavWithShare;
    setSharing(true);
    setShareError(null);
    try {
      await copyCaption();
      if (!nav.share || !nav.canShare || mediaCount === 0) {
        setShareError("Native sharing is not available here. Use the Facebook-native checklist above.");
        return;
      }

      const files = (
        await Promise.all(
          media
            .filter((item) => item.url)
            .map(async (item, index) => {
              const res = await fetch(mediaDownloadUrl(item.id));
              if (!res.ok) return null;
              const blob = await res.blob();
              const ext = item.mimeType.split("/")[1] ?? "bin";
              const name = filenameFromUrl(item.url!, `gil-facebook-${postId}-${index + 1}.${ext}`);
              return new File([blob], name, { type: item.mimeType });
            }),
        )
      ).filter((file): file is File => file !== null);

      if (files.length > 0 && nav.canShare({ files })) {
        await nav.share({ files, text: body, title: "Facebook post" });
        return;
      }
      setShareError("This media cannot be handed to Facebook through native share.");
    } catch {
      setShareError("Native share did not complete. Use the Facebook-native checklist above.");
    } finally {
      setSharing(false);
    }
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
        className="sticky top-0 z-20 border-b border-black/5 bg-[#f7f7f4]/95 px-4 pb-3 pt-3 backdrop-blur md:px-8"
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
              Facebook Share Assistant
            </div>
            <h1 className="truncate text-xl font-semibold tracking-normal text-gray-950">
              Post with the real Facebook app
            </h1>
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
        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Check className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Hub copy is saved</h2>
              <p className="mt-0.5 text-sm leading-snug text-gray-600">
                Now use Facebook&apos;s normal composer so Gil can post to feed, groups, and use Facebook tools.
              </p>
            </div>
          </div>

          <div className="rounded-[8px] border border-gray-100 bg-gray-50 p-3">
            <p className="line-clamp-5 whitespace-pre-wrap text-sm leading-relaxed text-gray-800">
              {body || "No caption."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void copyCaption()}
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-gray-950 px-4 text-sm font-semibold text-white active:scale-[0.99]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Caption copied" : "Copy caption again"}
          </button>
        </section>

        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Media on the phone</h2>
              <p className="mt-0.5 text-sm leading-snug text-gray-600">
                Save it first, then attach it inside Facebook like usual.
              </p>
            </div>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
              {mediaCount} file{mediaCount === 1 ? "" : "s"}
            </span>
          </div>

          {mediaCount > 0 && (
            <div className="mb-3 grid grid-cols-3 gap-1.5">
              {media
                .filter((item) => item.url)
                .slice(0, 6)
                .map((item) => (
                  <div key={item.id} className="aspect-square overflow-hidden rounded-[6px] bg-black">
                    {item.mimeType.startsWith("video/") ? (
                      <video src={item.url ?? ""} muted playsInline className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.url ?? ""} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleSaveAllMedia()}
            disabled={savingMedia || mediaCount === 0}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] bg-[#1877F2] px-4 text-sm font-semibold text-white disabled:opacity-50 active:scale-[0.99]"
          >
            {savingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : mediaSaved ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {savingMedia ? "Saving media..." : mediaSaved ? "Media saved" : "Save media to phone"}
          </button>

          {mediaError && (
            <p className="mt-2 rounded-[8px] bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
              {mediaError}
            </p>
          )}
        </section>

        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#1877F2]">
              <Smartphone className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold">Open Facebook composer</h2>
              <p className="mt-0.5 text-sm leading-snug text-gray-600">
                Caption is copied. Use the real composer to add music, choose groups, and edit the post.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleOpenDestination(destinations[0])}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#1877F2] px-4 text-base font-semibold text-white active:scale-[0.99]"
          >
            <SiFacebook className="h-5 w-5" />
            Open Facebook
          </button>
        </section>

        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-3">
            <h2 className="text-base font-semibold">Posting checklist</h2>
            <p className="mt-0.5 text-sm leading-snug text-gray-600">
              Mark each place after posting. Open buttons copy the caption first.
            </p>
          </div>

          <div className="space-y-2">
            {destinations.map((destination) => (
              <div
                key={destination.id}
                className={`rounded-[8px] border p-2.5 transition ${
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
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-gray-950">{destination.label}</div>
                    <div className="text-xs capitalize text-gray-500">{destination.type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleOpenDestination(destination)}
                    className="shrink-0 rounded-[8px] bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-800 active:bg-gray-200"
                  >
                    Open
                  </button>
                  {destination.type === "other" && (
                    <button
                      type="button"
                      onClick={() => removeDestination(destination.id)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-gray-400"
                      aria-label="Remove destination"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              placeholder="Other group name"
              className="min-h-11 min-w-0 flex-1 rounded-[8px] border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1877F2]"
            />
            <button
              type="button"
              onClick={addOtherDestination}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-gray-950 text-white"
              aria-label="Add group"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        </section>

        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <button
            type="button"
            onClick={() => setShortcutOpen((open) => !open)}
            className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-sm font-semibold">Optional shortcut</span>
              <span className="block text-xs text-gray-500">Use the limited share sheet for simple feed-only posts.</span>
            </span>
            <ChevronDown className={`h-4 w-4 transition ${shortcutOpen ? "rotate-180" : ""}`} />
          </button>
          {shortcutOpen && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                disabled={sharing}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 active:bg-gray-50 disabled:opacity-50"
              >
                {sharing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                Try native share sheet
              </button>
              {shareError && (
                <p className="mt-2 rounded-[8px] bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-900">
                  {shareError}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="rounded-[8px] bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Finish in the Hub</h2>
              <p className="mt-0.5 text-sm text-gray-600">
                {completedCount}/{destinations.length} destinations marked posted.
              </p>
            </div>
            {allDestinationsDone && (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Done
              </span>
            )}
          </div>
          <input
            type="url"
            inputMode="url"
            value={postingUrl}
            onChange={(e) => setPostingUrl(e.target.value)}
            placeholder="Optional Facebook post URL"
            disabled={marked}
            className="mb-3 min-h-11 w-full rounded-[8px] border border-gray-200 bg-white px-3 text-sm outline-none focus:border-[#1877F2] disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void handleMarkPosted()}
            disabled={marking || marked}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-emerald-600 px-4 text-base font-semibold text-white disabled:opacity-60 active:scale-[0.99]"
          >
            {marking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-5 w-5" />}
            {marked ? "Marked as posted" : "Mark Facebook posting done"}
          </button>
          {markError && <p className="mt-2 text-xs text-red-700">{markError}</p>}
        </section>
      </main>
    </div>
  );
}
