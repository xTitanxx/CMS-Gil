"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Check,
  Download,
  ExternalLink,
  Share2,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { SiFacebook } from "react-icons/si";

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

function filenameFromUrl(url: string, fallback: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || fallback;
    return last;
  } catch {
    return fallback;
  }
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older Safari / blocked clipboard fallback.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } finally {
      document.body.removeChild(ta);
    }
    return ok;
  }
}

function sanitizeReturnTo(value: string | null): string {
  if (!value) return "/admin/manual-fb";
  // Must be a same-origin path: starts with "/", not protocol-relative "//".
  if (!value.startsWith("/") || value.startsWith("//")) return "/admin/manual-fb";
  return value;
}

export function ManualPostHelper({ postId, body, originalDate, platformUrl, media }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams?.get("from") ?? null);
  const [copied, setCopied] = useState(false);
  const [autoCopiedBanner, setAutoCopiedBanner] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadedId, setDownloadedId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const [postedUrl, setPostedUrl] = useState("");
  const [isIOS, setIsIOS] = useState(false);
  const autoCopyDoneRef = useRef(false);

  const active = media[activeIdx] ?? null;
  const isVideo = active?.mimeType.startsWith("video/") ?? false;

  // UA-sniff once on mount: on iPhone/iPad we want `fb://composer` (drops the
  // user straight into a fresh FB post draft) and the Web Share API with
  // files (iOS share sheet → Save to Photos). On Mac/desktop both of those
  // are useless, so we route to facebook.com and direct browser download.
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsIOS(/iPhone|iPad|iPod/.test(navigator.userAgent));
    }
  }, []);

  // Auto-copy the caption on mount so the user can paste in Facebook
  // immediately — works whether they came from a push notification or
  // opened the app cold.
  useEffect(() => {
    if (autoCopyDoneRef.current) return;
    autoCopyDoneRef.current = true;
    if (!body.trim()) return;
    void (async () => {
      const ok = await copyTextToClipboard(body);
      if (ok) {
        setAutoCopiedBanner(true);
        setTimeout(() => setAutoCopiedBanner(false), 4000);
      }
    })();
  }, [body]);

  async function handleCopy() {
    const ok = await copyTextToClipboard(body);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  }

  async function handleDownload(item: Media): Promise<boolean> {
    if (!item.url) return false;
    setDownloading(item.id);
    setDownloadError(null);
    try {
      const res = await fetch(item.url);
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const ext = item.mimeType.split("/")[1] ?? "bin";
      const fname = filenameFromUrl(item.url, `gil-alter-${postId}.${ext}`);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fname;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      setDownloadedId(item.id);
      setTimeout(() => setDownloadedId(null), 2500);
      return true;
    } catch {
      setDownloadError("Download failed — open the media in a new tab and right-click → Save.");
      return false;
    } finally {
      setDownloading(null);
    }
  }

  async function handleShare(item: Media) {
    if (!item.url) return;
    type NavWithShare = Navigator & {
      share?: (data: { title?: string; text?: string; url?: string; files?: File[] }) => Promise<void>;
      canShare?: (data: { files?: File[] }) => boolean;
    };
    const nav = navigator as NavWithShare;

    // Only attempt Web Share when it can actually carry the file. On macOS
    // `navigator.share` exists but `canShare({files})` is false, and
    // `share({url, text})` just opens an OS sheet with no useful targets for
    // posting to FB — feels like "the button does nothing". So on anything
    // that's not iOS, go straight to a real file download.
    if (isIOS && nav.share && nav.canShare) {
      try {
        const res = await fetch(item.url);
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const blob = await res.blob();
        const ext = item.mimeType.split("/")[1] ?? "bin";
        const fname = filenameFromUrl(item.url, `gil-alter-${postId}.${ext}`);
        const file = new File([blob], fname, { type: item.mimeType });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ files: [file], text: body });
          return;
        }
      } catch {
        // fall through to download
      }
    }

    await handleDownload(item);
  }

  function handleOpenFacebook() {
    // iOS: deep-link straight into a fresh post draft in the FB app.
    // Anywhere else: a regular https://facebook.com tab — composer at the
    // top of the feed.
    if (isIOS) {
      window.location.href = "fb://composer";
    } else {
      window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
    }
  }

  async function handleMarkPosted() {
    if (marking || marked) return;
    setMarking(true);
    setMarkError(null);
    try {
      const trimmedUrl = postedUrl.trim();
      const body: Record<string, unknown> = { platform: "FACEBOOK" };
      if (trimmedUrl) body.platformUrl = trimmedUrl;
      const res = await fetch(`/api/posts/${postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkError(data?.error ?? "Couldn't mark as posted. Try again.");
        return;
      }
      setMarked(true);
      setTimeout(() => router.push(returnTo), 700);
    } finally {
      setMarking(false);
    }
  }

  return (
    <div className="-m-4 flex min-h-[calc(100vh-3.5rem)] flex-col bg-white md:-m-8">
      {/* Header */}
      <div
        className="flex items-center gap-2 border-b border-gray-100 bg-white/95 px-3 py-2 pl-14 backdrop-blur md:pl-8"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)" }}
      >
        <Link
          href={returnTo}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-gray-900">Post on Facebook personal</div>
          <div className="text-[11px] text-gray-500">
            From{" "}
            {new Date(originalDate).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>
        </div>
        {platformUrl && (
          <a
            href={platformUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            title="View original post"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Original
          </a>
        )}
      </div>

      {/* Auto-copied banner */}
      {autoCopiedBanner && (
        <div className="mx-auto mt-2 flex w-full max-w-md items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-900">
          <Check className="h-3.5 w-3.5 text-emerald-600" strokeWidth={2.5} />
          <span className="flex-1">Caption copied — paste it in Facebook.</span>
        </div>
      )}

      <div className="mx-auto w-full max-w-md flex-1 space-y-4 p-4">
        {/* Step 1: Copy text */}
        <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              1. Copy the caption
            </span>
            <button
              onClick={handleCopy}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                copied
                  ? "bg-emerald-600 text-white"
                  : "bg-gray-900 text-white hover:opacity-90 active:opacity-80"
              }`}
            >
              {copied ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy again"}
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3 text-[14px] leading-snug text-gray-800">
            {body ? (
              <p className="whitespace-pre-wrap">{body}</p>
            ) : (
              <p className="italic text-gray-400">No caption.</p>
            )}
          </div>
        </section>

        {/* Step 2: Save the media */}
        {media.length > 0 && (
          <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                2. Save the media
              </span>
              <span className="text-[11px] text-gray-400">
                {activeIdx + 1} / {media.length}
              </span>
            </div>

            {active?.url && (
              <div
                className="relative mb-2 overflow-hidden rounded-xl bg-black"
                style={{ aspectRatio: "1 / 1" }}
              >
                {isVideo ? (
                  <video src={active.url} controls playsInline className="h-full w-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={active.url} alt="" className="h-full w-full object-contain" />
                )}

                {media.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveIdx((i) => (i === 0 ? media.length - 1 : i - 1))}
                      className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65"
                      aria-label="Previous"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setActiveIdx((i) => (i + 1) % media.length)}
                      className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65"
                      aria-label="Next"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Primary CTA — Share to Photos on iOS, plain Download elsewhere. */}
            <button
              onClick={() => active && handleShare(active)}
              disabled={!active?.url || downloading === active?.id}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              {downloading === active?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : downloadedId === active?.id ? (
                <Check className="h-4 w-4" strokeWidth={2.5} />
              ) : isIOS ? (
                <Share2 className="h-4 w-4" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span className="min-w-0 break-words">
                {downloading === active?.id
                  ? "Downloading…"
                  : downloadedId === active?.id
                    ? isIOS
                      ? "Saved"
                      : "Downloaded"
                    : isIOS
                      ? "Share / Save to Photos"
                      : isVideo
                        ? "Download video"
                        : "Download image"}
              </span>
            </button>

            {/* Secondary: only useful on iOS where the primary opens a share
                sheet — gives an alternate "save the raw file" path. */}
            {isIOS && (
              <button
                onClick={() => active && handleDownload(active)}
                disabled={!active?.url || downloading === active?.id}
                className="mt-1.5 inline-flex w-full items-center justify-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-60"
              >
                <Download className="h-3.5 w-3.5" />
                <span className="break-words">Or download to Files</span>
              </button>
            )}

            {downloadError && (
              <p className="mt-2 break-words text-[11px] text-red-700">{downloadError}</p>
            )}

            <p className="mt-2 break-words text-[11px] text-gray-500">
              {isIOS
                ? 'Tap "Share / Save" → "Save Image" / "Save Video" to drop it into Photos.'
                : 'File goes to your Downloads folder — drag it from there into the Facebook composer.'}
            </p>
          </section>
        )}

        {/* Step 3: open Facebook */}
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-3 shadow-sm">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
            3. Post on Facebook
          </div>
          <p className="mb-2 break-words text-sm text-blue-900">
            {isIOS
              ? "Opens a fresh post draft in the Facebook app — paste the caption and attach the saved media."
              : "Opens facebook.com in a new tab — paste the caption into the composer and drag the downloaded file in."}
          </p>
          <button
            type="button"
            onClick={handleOpenFacebook}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <SiFacebook className="h-4 w-4" />
            <span className="break-words">Open Facebook</span>
          </button>
        </section>

        {/* Step 4: I posted it */}
        <section
          className={`rounded-2xl border p-3 shadow-sm transition-colors ${
            marked ? "border-emerald-200 bg-emerald-50" : "border-gray-200 bg-white"
          }`}
        >
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
            4. Confirm
          </div>
          <label className="mb-1 block text-[11px] font-medium text-gray-600">
            Paste the FB post URL (so it links from the post page)
          </label>
          <input
            type="url"
            inputMode="url"
            value={postedUrl}
            onChange={(e) => setPostedUrl(e.target.value)}
            placeholder="https://www.facebook.com/…"
            disabled={marked}
            className="mb-2 w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[13px] text-gray-800 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none disabled:opacity-60"
          />
          <button
            onClick={handleMarkPosted}
            disabled={marking || marked}
            className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg py-3 text-sm font-semibold text-white shadow-sm transition-colors disabled:opacity-70 ${
              marked ? "bg-emerald-600" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {marking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : marked ? (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            ) : (
              <Check className="h-4 w-4" strokeWidth={2.5} />
            )}
            {marked ? "Marked as posted" : "I posted it on Facebook"}
          </button>
          {markError && <p className="mt-1.5 text-[11px] text-red-700">{markError}</p>}
          <p className="mt-1.5 text-[11px] text-gray-500">
            Optional — leave the URL blank to mark posted without a link. Either way,
            this clears the post from the manual-posts queue.
          </p>
        </section>
      </div>
    </div>
  );
}
