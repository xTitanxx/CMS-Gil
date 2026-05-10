"use client";

import { PushOptIn } from "@/components/PushOptIn";

export function NotificationsTab() {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Push notifications</h2>
        <p className="text-sm text-gray-500">
          Get a heads-up ~15 minutes before each scheduled slot, in particular for
          posts you have to cross-post manually to Facebook personal.
        </p>
        <p className="mt-1 text-xs text-gray-400">
          On iOS you must first add this site to your Home Screen and open it from
          there before notifications can be enabled.
        </p>
      </div>
      <div className="px-6 py-4">
        <div className="max-w-md">
          <PushOptIn />
        </div>
      </div>
    </section>
  );
}
