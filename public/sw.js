// Service worker for PWA push notifications.
// Lives at the site root so its scope covers the whole app.
//
// Receives push events from the server and surfaces them as iOS/Android
// system notifications. Tapping a notification opens (or focuses) the URL
// embedded in the payload — for FB-personal reminders this is the
// /admin/m/[postId] manual-post helper.

self.addEventListener("install", (event) => {
  // Activate as soon as the new SW is ready — no point waiting for tabs to close.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
