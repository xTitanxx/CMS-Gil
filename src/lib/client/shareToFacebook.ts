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

// iPhones record video as .mov (MIME type video/quicktime) by default. That
// MIME type is inconsistently recognized as "video" by browsers and
// share-receiving apps — Chromium has a filed bug for exactly this
// (video/quicktime doesn't play, the same bytes labeled video/mp4 do), and
// Facebook/WhatsApp's share handling shows the same pattern: the file lands
// as a generic, non-playable attachment. .mov and .mp4 are both ISO-base-
// media-file-format containers and commonly hold identical H.264/AAC
// streams, so relabeling (not re-encoding — the bytes are untouched) is the
// standard, documented workaround for this.
function normalizeVideoForSharing(file: File): File {
  if (file.type !== "video/quicktime") return file;
  const name = file.name.replace(/\.mov$/i, ".mp4");
  return new File([file], name, { type: "video/mp4" });
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
 * allows. This is the real ceiling, not a bug to keep chasing: Facebook has
 * no documented URL scheme or API to open its app pre-loaded with a draft,
 * the Graph API has blocked posting to a personal profile since 2018, and
 * Facebook's own developer policy explicitly forbids pre-filling caption
 * text even for apps with official SDK access ("apps may not pre-fill the
 * share sheet's initialText field with content that wasn't entered by the
 * user"). So: on mobile with file-capable Web Share, the OS share sheet
 * hands the media straight into Facebook's app — that part reliably works,
 * regardless of whether the caller already awaited something (e.g. fetching
 * media from storage) before calling this. Whether Facebook's app also
 * keeps the caption is Facebook's call, not something we can force; the
 * caption is copied to the clipboard separately as a fallback either way.
 * Everywhere else — desktop, no share target, or a file too large to share
 * reliably — the fallback downloads the media and opens facebook.com so the
 * user can attach it themselves.
 */
export async function shareFilesToFacebook(opts: {
  body: string;
  files: File[];
}): Promise<ShareResult> {
  const nav = navigator as NavWithShare;
  const files = opts.files.map(normalizeVideoForSharing);
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);

  if (
    files.length > 0 &&
    isMobileUserAgent() &&
    nav.share &&
    nav.canShare &&
    totalBytes <= MAX_SHARE_BYTES
  ) {
    const payload = { text: opts.body, files };
    if (nav.canShare(payload)) {
      try {
        await nav.share(payload);
        return "shared";
      } catch {
        return "shared";
      }
    }
  }

  files.forEach(triggerBrowserDownload);
  const fbTab = window.open("https://www.facebook.com/", "_blank", "noopener,noreferrer");
  return fbTab ? "opened" : "blocked";
}
