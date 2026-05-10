"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2, Smartphone, Check } from "lucide-react";
import {
  isPushSupported,
  isStandalonePwa,
  getCurrentSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push/client";

type State = "idle" | "subscribed" | "loading" | "denied" | "unsupported";

export function PushOptIn({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<State>("loading");
  const [reason, setReason] = useState<string | null>(null);
  const [needsInstall, setNeedsInstall] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isPushSupported()) {
        if (!cancelled) setState("unsupported");
        return;
      }
      // iOS Safari requires the PWA to be installed; nudge the user if not.
      const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
      if (isIos && !isStandalonePwa()) setNeedsInstall(true);

      if (typeof Notification !== "undefined" && Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      const sub = await getCurrentSubscription();
      if (!cancelled) setState(sub ? "subscribed" : "idle");
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSubscribe() {
    setState("loading");
    setReason(null);
    const result = await subscribeToPush();
    if (result.ok) {
      setState("subscribed");
    } else {
      setReason(result.reason ?? "Failed to subscribe.");
      setState("idle");
    }
  }

  async function handleUnsubscribe() {
    setState("loading");
    await unsubscribeFromPush();
    setState("idle");
  }

  if (state === "unsupported") {
    return compact ? null : (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
        {"This browser doesn't support push notifications."}
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Notifications are blocked. Re-enable them in your browser/system settings to get post reminders.
      </div>
    );
  }

  if (state === "subscribed") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
        <div className="flex items-center gap-2 text-sm text-emerald-900">
          <Check className="h-4 w-4 text-emerald-600" strokeWidth={2.5} />
          <span className="font-medium">Notifications on</span>
        </div>
        <button
          onClick={handleUnsubscribe}
          className="inline-flex items-center gap-1 rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
        >
          <BellOff className="h-3.5 w-3.5" />
          Turn off
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50 p-3">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-purple-600 p-1.5 text-white">
          <Bell className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">Get post reminders</div>
          <p className="mt-0.5 text-[12px] text-gray-700">
            {"We'll ping you ~15 min before each scheduled slot so you can manually post on Facebook personal."}
          </p>
          {needsInstall && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-white/70 p-2 text-[11px] text-gray-700">
              <Smartphone className="mt-0.5 h-3 w-3 shrink-0 text-purple-600" />
              <span>
                {'On iOS, first add this site to your Home Screen (Share → "Add to Home Screen"), then open it from there to enable notifications.'}
              </span>
            </div>
          )}
          {reason && (
            <p className="mt-1.5 text-[11px] text-red-700">{reason}</p>
          )}
          <button
            onClick={handleSubscribe}
            disabled={state === "loading"}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-purple-700 disabled:opacity-60"
          >
            {state === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
            Turn on notifications
          </button>
        </div>
      </div>
    </div>
  );
}
