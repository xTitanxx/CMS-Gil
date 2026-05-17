"use client";

import { useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInForm({
  next,
  initialCode = "",
  autoSubmit = false,
}: {
  next: string;
  initialCode?: string;
  autoSubmit?: boolean;
}) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const autoTried = useRef(false);

  async function attemptSignIn(rawCode: string) {
    setLoading(true);
    setError("");

    // Trim only — server-side `findSubscriberByCode` handles case-insensitivity.
    await signIn("subscriber-credentials", {
      code: rawCode.trim(),
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

  // Auto-login from an invite link (?code=gil-bob). Fires once on mount, then
  // falls back to the visible form on failure so the user can correct typos
  // a copy-paste might have introduced.
  useEffect(() => {
    if (!autoSubmit || autoTried.current || !initialCode.trim()) return;
    autoTried.current = true;
    void attemptSignIn(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, initialCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void attemptSignIn(code);
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
        autoCorrect="off"
        spellCheck={false}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base lowercase text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
