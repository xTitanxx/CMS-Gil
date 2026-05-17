"use client";

import { useEffect } from "react";

// Registers /sw.js on every page load so the cache is populated even for users
// who never opt into push notifications. The SW caches Next.js static chunks
// and runs stale-while-revalidate on navigation responses — the difference
// between a PWA that feels native and one that hits the network every tap.
//
// Registration is idempotent; the browser dedupes by scope + script URL.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Defer past first paint so registration never competes with hydration.
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ??
      ((cb: () => void) => window.setTimeout(cb, 1));
    idle(() => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // SW is a perf optimization, not a correctness requirement —
          // silently swallow failures so a broken registration never breaks
          // the app.
        });
    });
  }, []);

  return null;
}
