"use client";

/**
 * Copies text to the clipboard, falling back to a hidden textarea +
 * execCommand("copy") for browsers that block the async Clipboard API
 * (older Safari, or when the page isn't focused).
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
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

type NavWithShare = Navigator & {
  share?: (data: { text?: string; files?: File[] }) => Promise<void>;
  canShare?: (data: { text?: string; files?: File[] }) => boolean;
};

function isMobileUserAgent(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function triggerBrowserDownload(file: File): void {
  const objectUrl = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

// Conservative ceiling for handing a video to the OS share sheet. Some
// mobile browsers pass `canShare()` for a large file and then silently fail
// (or hang) inside `share()` itself — safer to route large files straight to
// the download+open-Facebook fallback than to gamble on a share sheet that
// may never resolve.
const MAX_SHARE_BYTES = 100 * 1024 * 1024;

export type ShareResult = "shared" | "opened" | "blocked";

/**
 * Hand a caption + media to Facebook with the least friction the platform
 * allows. There is no API to publish to a personal profile, so this is the
 * floor: on mobile with file-capable Web Share, the OS share sheet drops the
 * media (and, when Facebook's app honors it, the caption) straight into a
 * fresh Facebook post. Everywhere else — desktop, no share target, a file
 * too large to share reliably, or a caller that had to fetch its files over
 * the network first — the fallback downloads the media locally and opens
 * facebook.com so the user can drag it into the composer.
 *
 * `allowNativeShare` defaults to true but MUST be set to false by any caller
 * that awaited a network request (e.g. fetching media bytes from storage)
 * before calling this function. `navigator.share()` requires the browser's
 * "transient user activation" to still be live from the original tap — once
 * a real fetch has happened first, that activation is reliably gone, and
 * browsers respond inconsistently: some silently no-op, others open the
 * sheet but silently drop the files/caption payload. Only a caller with
 * files already in memory at the moment of the tap (nothing awaited yet)
 * can rely on the native share path.
 */
export async function shareFilesToFacebook(opts: {
  body: string;
  files: File[];
  allowNativeShare?: boolean;
}): Promise<ShareResult> {
  const nav = navigator as NavWithShare;
  const allowNativeShare = opts.allowNativeShare ?? true;
  const totalBytes = opts.files.reduce((sum, f) => sum + f.size, 0);

  if (
    allowNativeShare &&
    opts.files.length > 0 &&
    isMobileUserAgent() &&
    nav.share &&
    nav.canShare &&
    totalBytes <= MAX_SHARE_BYTES
  ) {
    const payload = { text: opts.body, files: opts.files };
    if (nav.canShare(payload)) {
      try {
        await nav.share(payload);
        return "shared";
      } catch {
        return "shared";
      }
    }
  }

  opts.files.forEach(triggerBrowserDownload);
  const fbTab = window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
  return fbTab ? "opened" : "blocked";
}
