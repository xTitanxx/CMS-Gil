"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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

export function ManualPostHelper({ postId, body, originalDate, platformUrl, media }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [autoCopiedBanner, setAutoCopiedBanner] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);
  const autoCopyDoneRef = useRef(false);

  const active = media[activeIdx] ?? null;
  const isVideo = active?.mimeType.startsWith("video/") ?? false;

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

  async function handleDownload(item: Media) {
    if (!item.url) return;
    setDownloading(item.id);
    try {
      const res = await fetch(item.url);
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
    if (!nav.share) {
      await handleDownload(item);
      return;
    }
    try {
      const res = await fetch(item.url);
      const blob = await res.blob();
      const ext = item.mimeType.split("/")[1] ?? "bin";
      const fname = filenameFromUrl(item.url, `gil-alter-${postId}.${ext}`);
      const file = new File([blob], fname, { type: item.mimeType });
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], text: body });
        return;
      }
      await nav.share({ url: item.url, text: body });
    } catch {
      // User cancelled or share failed — silent no-op.
    }
  }

  async function handleMarkPosted() {
    if (marking || marked) return;
    setMarking(true);
    setMarkError(null);
    try {
      const res = await fetch(`/api/posts/${postId}/manual-publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: "FACEBOOK" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMarkError(data?.error ?? "Couldn't mark as posted. Try again.");
        return;
      }
      setMarked(true);
      setTimeout(() => router.push("/admin/suggest"), 700);
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
          href="/admin/suggest"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200"
          aria-label="Back to suggester"
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

            {/* Primary CTA: Share / Save (iOS hits Photos sheet reliably) */}
            <button
              onClick={() => active && handleShare(active)}
              disabled={!active?.url}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            >
              <Share2 className="h-4 w-4" />
              Share / Save to Photos
            </button>

            {/* Secondary download */}
            <button
              onClick={() => active && handleDownload(active)}
              disabled={!active?.url || downloading === active?.id}
              className="mt-1.5 inline-flex w-full items-center justify-center gap-1 text-[12px] font-medium text-gray-500 hover:text-gray-700 disabled:opacity-60"
            >
              <Download className="h-3.5 w-3.5" />
              Or download to Files
            </button>

            <p className="mt-2 text-[11px] text-gray-500">
              {'On iOS, tap "Share / Save" → "Save Image" / "Save Video" to drop it into your Photos.'}
            </p>
          </section>
        )}

        {/* Step 3: open Facebook */}
        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-3 shadow-sm">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-blue-800">
            3. Post on Facebook
          </div>
          <p className="mb-2 text-sm text-blue-900">
            Open the Facebook app, paste the caption, and attach the saved media.
          </p>
          <a
            href="fb://composer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1877F2] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90"
          >
            <SiFacebook className="h-4 w-4" />
            Open Facebook
          </a>
          <p className="mt-1.5 text-[11px] text-blue-800/80">
            {"(If the app doesn't open, tap and hold to open in Safari instead.)"}
          </p>
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
            Tracks the post as published so it leaves the manual-posts queue.
          </p>
        </section>
      </div>
    </div>
  );
}
