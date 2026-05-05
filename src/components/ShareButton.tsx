"use client";

import { useState } from "react";
import { Share2, Check } from "lucide-react";

interface Props {
  url: string;
  title?: string;
  className?: string;
  label?: string;
}

/**
 * Web Share API where supported (mobile + Safari/Chrome desktop with HTTPS),
 * clipboard fallback elsewhere with a transient "Link copied!" indicator.
 *
 * The native share sheet on mobile already includes Facebook / X / WhatsApp /
 * etc., so no need for explicit per-platform buttons.
 */
export function ShareButton({ url, title, className, label = "Share" }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleShare() {
    const absoluteUrl = url.startsWith("http")
      ? url
      : typeof window !== "undefined"
      ? new URL(url, window.location.origin).toString()
      : url;

    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: title ?? document.title, url: absoluteUrl });
        return;
      } catch (err) {
        // User cancelled or permission denied — fall through to clipboard.
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — last resort, do nothing visible.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={
        className ??
        "flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
      }
    >
      {copied ? (
        <>
          <Check className="h-5 w-5 text-green-600" />
          <span>Copied!</span>
        </>
      ) : (
        <>
          <Share2 className="h-5 w-5" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
