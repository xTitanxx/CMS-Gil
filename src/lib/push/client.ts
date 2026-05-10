// Client-side helpers for registering the service worker and managing the
// browser's PushSubscription. iOS Safari only fires push events when the
// PWA is *installed* to the home screen — we surface that requirement in
// the opt-in UI so the user knows what to do on their phone.

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const padded = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isPushSupported(): boolean {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari sets navigator.standalone; modern browsers expose
  // display-mode media query. iOS push only works in standalone mode.
  type WithStandalone = Navigator & { standalone?: boolean };
  const navStandalone = (navigator as WithStandalone).standalone === true;
  const mqStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  return navStandalone || mqStandalone;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function getCurrentSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (!isPushSupported()) return { ok: false, reason: "Push not supported in this browser." };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "Permission denied." };

  const reg = await registerServiceWorker();
  if (!reg) return { ok: false, reason: "Service worker registration failed." };

  const keysRes = await fetch("/api/push/keys");
  if (!keysRes.ok) return { ok: false, reason: "VAPID keys not configured on the server." };
  const { publicKey } = (await keysRes.json()) as { publicKey: string };

  // Replace any existing sub on this device — keys can rotate.
  const existing = await reg.pushManager.getSubscription();
  if (existing) await existing.unsubscribe().catch(() => {});

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const subJson = sub.toJSON();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: subJson.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) {
    return { ok: false, reason: "Failed to register subscription with the server." };
  }
  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<boolean> {
  const sub = await getCurrentSubscription();
  if (!sub) return true;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => {});
  await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, { method: "DELETE" });
  return true;
}
