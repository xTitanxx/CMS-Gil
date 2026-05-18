// Tracks where the user came from when entering a post detail page so the
// "← Posts" back button can return them to that exact list page and scroll
// position — including pages other than /admin/posts (triage, scheduled,
// published, etc.).
//
// Scroll-container note: the admin layout puts `overflow-y-auto` on
// <main id="main-content">. On desktop the page scrolls inside that
// element; on mobile (no parent height cap) the page scrolls on the
// window. We capture and restore both so the right one wins on each
// breakpoint.

const RETURN_KEY = "postDetailReturn";
const PENDING_KEY = "postDetailPendingScroll";

export type PostReturn = {
  url: string;
  mainScroll: number;
  windowScroll: number;
};

export type PendingScroll = {
  url: string;
  mainScroll: number;
  windowScroll: number;
};

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key, value);
  } catch {}
}

function safeRemove(key: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(key);
  } catch {}
}

export function captureCurrentReturn(): void {
  if (typeof window === "undefined") return;
  const main = document.getElementById("main-content");
  const data: PostReturn = {
    url: window.location.pathname + window.location.search,
    mainScroll: main ? main.scrollTop : 0,
    windowScroll: window.scrollY,
  };
  safeSet(RETURN_KEY, JSON.stringify(data));
}

export function readReturn(): PostReturn | null {
  const raw = safeGet(RETURN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PostReturn;
    if (typeof parsed?.url !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setPendingScroll(p: PendingScroll): void {
  safeSet(PENDING_KEY, JSON.stringify(p));
}

export function consumePendingScroll(currentUrl: string): PendingScroll | null {
  const raw = safeGet(PENDING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingScroll;
    if (typeof parsed?.url !== "string") {
      safeRemove(PENDING_KEY);
      return null;
    }
    if (parsed.url !== currentUrl) return null;
    safeRemove(PENDING_KEY);
    return parsed;
  } catch {
    safeRemove(PENDING_KEY);
    return null;
  }
}
