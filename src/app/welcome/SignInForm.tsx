"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    await signIn("subscriber-credentials", {
      code: code.trim(),
      redirect: false,
    });

    // NextAuth v5's signIn return shape doesn't reliably expose failures
    // for the Credentials provider — invalid codes can come back looking
    // like a successful redirect. Verify by fetching the actual session.
    let isSubscriber = false;
    try {
      const sessionRes = await fetch("/api/auth/session", { cache: "no-store" });
      const session = await sessionRes.json();
      isSubscriber = !!(session?.user && session.user.role === "subscriber");
    } catch {
      isSubscriber = false;
    }

    setLoading(false);
    if (isSubscriber) {
      // Open-redirect guard: only allow same-origin paths even though the
      // server-side page validates `next` too — defense in depth.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      window.location.assign(safeNext);
    } else {
      setError("Code not recognized. Please double-check, or message Gil on Facebook.");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="gil-xxxxxxxx"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        required
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={loading || code.length === 0}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? "Signing in…" : "Enter"}
      </button>
    </form>
  );
}
