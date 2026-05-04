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
    const res = await signIn("subscriber-credentials", {
      code: code.trim(),
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      window.location.assign(next);
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
