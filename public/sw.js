// Service worker for the PWA.
//
// Two jobs:
//   1) Make repeat visits *fast*. The PWA can't keep a warm tab the way a
//      browser does, so without caching every cold launch repays the full
//      cost of downloading the JS bundle and waiting for an RSC roundtrip.
//      We cache immutable static chunks aggressively, and serve a stale
//      navigation HTML response while revalidating in the background.
//   2) Surface push notifications. (Previous behavior, unchanged.)
//
// Cache strategy:
//   - /_next/static/* and other immutable assets → cache-first, forever.
//     Next.js fingerprints these filenames, so a new deploy ships new URLs
//     and old entries naturally fall out of use.
//   - Same-origin GET navigations (HTML / RSC) under /admin → always
//     network, never cached. /admin is the CMS itself, actively developed
//     and redeployed many times a day by its one user — stale-while-
//     revalidate's whole point (paint instantly, refresh in the background)
//     is exactly backwards there: it means every deploy needs an extra
//     reload before a fix actually shows up, which looks indistinguishable
//     from the fix not having worked at all.
//   - Every other same-origin GET navigation (the public reader-facing
//     pages) → stale-while-revalidate with a short network race so online
//     users always see fresh content within ~1.5s but never wait on a cold
//     lambda before *something* paints. Failed fetches fall back to the
//     cached copy.
//   - Everything else (API, cross-origin) → straight network. We never
//     cache mutations or auth-sensitive JSON.

const VERSION = "v3";
const STATIC_CACHE = `static-${VERSION}`;
const NAV_CACHE = `nav-${VERSION}`;

const STATIC_URL_PATTERNS = [
  /^\/_next\/static\//,
  /^\/icon-\d+\.png$/,
  /^\/icon\.jpg$/,
  /^\/avatar\.jpg$/,
  /^\/banner\.jpg$/,
  /^\/.*\.svg$/,
];

self.addEventListener("install", (event) => {
  // Activate as soon as the new SW is ready — no point waiting for tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions so we don't accumulate forever.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== NAV_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return STATIC_URL_PATTERNS.some((re) => re.test(url.pathname));
}

function isNavigationRequest(request) {
  // RSC fetches don't set mode: "navigate" — they're regular fetches with
  // an RSC header. Treat both as navigations so they share the cache.
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/x-component")) return true;
  if (request.headers.get("rsc") || request.headers.get("next-router-state-tree")) {
    return true;
  }
  return false;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkPromise = (async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        // Clone before stashing — body is a one-shot stream.
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    } catch {
      return null;
    }
  })();

  if (cached) {
    // Kick off revalidation but don't wait for it.
    networkPromise.catch(() => {});
    return cached;
  }
  // No cache hit — we have to wait on the network.
  const res = await networkPromise;
  if (res) return res;
  return new Response("Offline", { status: 503, statusText: "Offline" });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    return new Response("Offline", { status: 503, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — auth-sensitive, mutation-bearing, or polling.
  if (url.pathname.startsWith("/api/")) return;

  // Never cache the auth pages or the public welcome flow. They redirect.
  if (
    url.pathname === "/login" ||
    url.pathname === "/welcome" ||
    url.pathname === "/logout"
  ) {
    return;
  }

  // Never cache the admin CMS — see the cache-strategy note at the top of
  // this file for why.
  if (url.pathname.startsWith("/admin")) return;

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(staleWhileRevalidate(request, NAV_CACHE));
    return;
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: event.data ? event.data.text() : "Notification", body: "" };
  }

  const title = payload.title || "Gil Alter";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: payload.badge || "/icon-192.png",
    tag: payload.tag || undefined,
    // Re-show the notification even when one with the same tag is already on
    // screen — feels more useful for recurring slot reminders.
    renotify: !!payload.tag,
    data: { url: payload.url || "/admin" },
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/admin";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Prefer focusing an existing tab on the same origin and navigating it.
      for (const client of allClients) {
        try {
          const url = new URL(client.url);
          if (url.origin === self.location.origin) {
            await client.focus();
            if ("navigate" in client) {
              await client.navigate(targetUrl);
            }
            return;
          }
        } catch {
          // Ignore malformed client URLs.
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
