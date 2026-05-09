// Server-side Web Push helper. Wraps the `web-push` library so the rest of
// the app talks to a small typed API. VAPID keys come from env:
//   VAPID_PUBLIC_KEY      — base64url, also fed to the client for subscribe
//   VAPID_PRIVATE_KEY     — base64url, server-only
//   VAPID_SUBJECT         — mailto:... or https://... contact for the spec
//
// Generate keys once with: `npx web-push generate-vapid-keys --json`
// then push to Vercel:    `vercel env add VAPID_PUBLIC_KEY production` etc.
import "server-only";
import webpush, { type PushSubscription, type SendResult } from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@gilalter.com";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys missing — set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
}

export interface SendResultRow {
  endpoint: string;
  success: boolean;
  statusCode?: number;
  removed?: boolean;
}

/**
 * Send a push notification to all of a user's subscribed devices.
 * Stale subscriptions (404/410) are deleted so they don't block future sends.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<SendResultRow[]> {
  ensureConfigured();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return [];

  const body = JSON.stringify(payload);
  const results: SendResultRow[] = [];

  for (const sub of subs) {
    const target: PushSubscription = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.p256dh, auth: sub.auth },
    };
    try {
      const r: SendResult = await webpush.sendNotification(target, body, { TTL: 60 * 60 });
      results.push({ endpoint: sub.endpoint, success: true, statusCode: r.statusCode });
    } catch (err: unknown) {
      const status = typeof err === "object" && err !== null && "statusCode" in err
        ? Number((err as { statusCode: unknown }).statusCode)
        : undefined;
      // 404 = endpoint gone, 410 = subscription expired.
      if (status === 404 || status === 410) {
        await prisma.pushSubscription.delete({ where: { endpoint: sub.endpoint } }).catch(() => {});
        results.push({ endpoint: sub.endpoint, success: false, statusCode: status, removed: true });
      } else {
        results.push({ endpoint: sub.endpoint, success: false, statusCode: status });
      }
    }
  }

  return results;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}
