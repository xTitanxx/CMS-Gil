"use client";

import { useState } from "react";
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

export function ManualPostHelper({ postId, body, originalDate, platformUrl, media }: Props) {
  const [copied, setCopied] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);

  const active = media[activeIdx] ?? null;
  const isVideo = active?.mimeType.startsWith("video/") ?? false;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select text manually if clipboard API fails (older Safari)
      const ta = document.createElement("textarea");
      ta.value = body;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  async function handleDownload(item: Media) {
    if (!item.url) return;
    setDownloading(item.id);
    try {
      // On iOS Safari, fetching the blob and using URL.createObjectURL gives
      // the user a "Save Image" / "Save Video" sheet. Direct anchor with
      // download attribute is ignored on iOS; this path is the workaround.
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
      // Falls through to URL share (iOS may show a Save to Files / Photos option)
      await nav.share({ url: item.url, text: body });
    } catch {
      // User cancelled or share failed — silently no-op.
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
          href="/admin/dashboard"
          className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 active:bg-gray-200"
          aria-label="Back to dashboard"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold text-gray-900">Post on Facebook personal</div>
          <div className="text-[11px] text-gray-500">
            From {new Date(originalDate).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
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
              {copied ? "Copied" : "Copy"}
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

        {/* Step 2: Download media */}
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
              <div className="relative mb-2 overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "1 / 1" }}>
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

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => active && handleDownload(active)}
                disabled={!active?.url || downloading === active?.id}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white py-2.5 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
              >
                <Download className="h-4 w-4" />
                Download
              </button>
              <button
                onClick={() => active && handleShare(active)}
                disabled={!active?.url}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
              >
                <Share2 className="h-4 w-4" />
                Share / Save
              </button>
            </div>

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
      </div>
    </div>
  );
}
