"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { buildInviteMessage } from "./inviteMessage";

type Subscriber = {
  id: string;
  name: string;
  email: string | null;
  displayName: string | null;
  monthlyBudgetUsd: number;
  cycleStart: string;
  cycleUsedUsd: number;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  commentsDisabledAt: string | null;
};

function deriveCodeFromName(name: string): string {
  // Match server-side `deriveCodeFromName` — lowercase so the preview the
  // admin sees matches the code actually issued.
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  return cleaned ? `gil-${cleaned}` : "";
}

// Plaintext codes are bcrypt-hashed on the server — once issued, the API
// can't reveal them again. Caching the most recently shown code in this
// admin's localStorage lets "Hide" → "Show invite" round-trip without
// triggering a regeneration (which would invalidate the code the subscriber
// already received). Regeneration is now an explicit action inside the
// revealed-message panel.
const INVITE_CACHE_KEY = "admin:subscriberInviteCodes:v1";

function loadInviteCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(INVITE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function persistInviteCache(cache: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(INVITE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage may be unavailable (private mode, quota) — silently skip;
    // the admin will just have to regenerate to recover the code.
  }
}

export function SubscribersListClient() {
  const [list, setList] = useState<Subscriber[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [budget, setBudget] = useState("1.20");
  const [generated, setGenerated] = useState<{ name: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [inviteBusy, setInviteBusy] = useState<Record<string, boolean>>({});
  const [inviteCode, setInviteCode] = useState<Record<string, string>>({});

  async function refresh() {
    const res = await fetch("/api/admin/subscribers");
    if (res.ok) {
      const data = await res.json();
      setList(data.subscribers ?? []);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  // Surface cached codes for any subscriber the admin has revealed before in
  // this browser, so "Hide" doesn't actually lose the code — re-clicking
  // "Show invite" just reads it back without regenerating.
  function rememberCode(id: string, code: string) {
    const next = { ...loadInviteCache(), [id]: code };
    persistInviteCache(next);
  }
  function forgetCode(id: string) {
    const next = loadInviteCache();
    delete next[id];
    persistInviteCache(next);
  }

  function handleNameChange(value: string) {
    setName(value);
    if (!passwordEdited) {
      setPassword(deriveCodeFromName(value));
    }
  }

  function handlePasswordChange(value: string) {
    // Server stores codes lowercased — reflect that in the input so the admin
    // sees the exact code the subscriber will receive.
    setPassword(value.toLowerCase());
    setPasswordEdited(true);
  }

  function resetForm() {
    setName("");
    setEmail("");
    setPassword("");
    setPasswordEdited(false);
    setBudget("1.20");
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const res = await fetch("/api/admin/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email: email.trim() || null,
        code: password.trim() || undefined,
        monthlyBudgetUsd: Number(budget),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json()).error ?? "Failed");
      return;
    }
    const { code, subscriber } = await res.json();
    setGenerated({ name: subscriber.name, code });
    rememberCode(subscriber.id, code);
    resetForm();
    void refresh();
  }

  // "Show invite" is a pure reveal: if we already have the code cached for
  // this browser, we surface it without touching the server. Only when the
  // cache is empty (first reveal ever, or a different browser) do we POST to
  // regenerate-code — and that path still pops the existing confirm for
  // already-signed-in subscribers, because in that case we genuinely will
  // invalidate their old code.
  async function handleInvite(s: Subscriber) {
    const cached = loadInviteCache()[s.id];
    if (cached) {
      setInviteCode((prev) => ({ ...prev, [s.id]: cached }));
      return;
    }
    if (
      s.lastSeenAt &&
      !confirm(`${s.name} has already signed in and we don't have a copy of their code here. Generating a new one will invalidate their old code. Continue?`)
    )
      return;
    setInviteBusy((prev) => ({ ...prev, [s.id]: true }));
    try {
      const res = await fetch(`/api/admin/subscribers/${s.id}/regenerate-code`, {
        method: "POST",
      });
      if (res.ok) {
        const { code } = await res.json();
        setInviteCode((prev) => ({ ...prev, [s.id]: code }));
        rememberCode(s.id, code);
      }
    } finally {
      setInviteBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  }

  // Explicit regeneration — always confirms, always POSTs, always replaces
  // the cached code with the new one.
  async function handleRegenerate(s: Subscriber) {
    if (
      !confirm(
        `Regenerate ${s.name}'s code? Their previous code (whether known or not) stops working immediately.`,
      )
    )
      return;
    setInviteBusy((prev) => ({ ...prev, [s.id]: true }));
    try {
      const res = await fetch(`/api/admin/subscribers/${s.id}/regenerate-code`, {
        method: "POST",
      });
      if (res.ok) {
        const { code } = await res.json();
        setInviteCode((prev) => ({ ...prev, [s.id]: code }));
        rememberCode(s.id, code);
      }
    } finally {
      setInviteBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  }

  function dismissInvite(id: string) {
    // Hide the reveal panel but KEEP the cached code — re-clicking "Show invite"
    // should bring back the same code, not regenerate.
    setInviteCode((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function forgetInvite(id: string) {
    // Explicit "forget" — drops the cache too, so the next reveal must
    // regenerate. Useful when the admin wants to start fresh without
    // immediately invalidating the subscriber's current code.
    forgetCode(id);
    dismissInvite(id);
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      {list.length === 0 ? (
        <div className="px-6 py-8 text-center text-sm text-gray-500">
          No subscribers yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr>
                <th className="px-6 py-2 font-medium">Name</th>
                <th className="py-2 font-medium">Email</th>
                <th className="py-2 font-medium">Last seen</th>
                <th className="py-2 font-medium">Spent / Budget</th>
                <th className="py-2 font-medium">State</th>
                <th className="px-6 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.map((s) => {
                const pct =
                  s.monthlyBudgetUsd > 0
                    ? Math.min(100, Math.round((s.cycleUsedUsd / s.monthlyBudgetUsd) * 100))
                    : 100;
                const msg = inviteCode[s.id]
                  ? buildInviteMessage(
                      s.name,
                      inviteCode[s.id],
                      typeof window !== "undefined" ? window.location.origin : "https://gilalter.com",
                    )
                  : null;
                return (
                  <Fragment key={s.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-6 py-3">
                        <Link
                          href={`/admin/subscribers/${s.id}`}
                          className="font-medium text-blue-700 hover:underline"
                        >
                          {s.name}
                        </Link>
                      </td>
                      <td className="py-3 text-gray-700">{s.email ?? "—"}</td>
                      <td className="py-3 text-gray-700">
                        {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "—"}
                      </td>
                      <td className="py-3 text-gray-700">
                        ${s.cycleUsedUsd.toFixed(2)} / ${s.monthlyBudgetUsd.toFixed(2)}
                        <span className="ml-1 text-xs text-gray-500">({pct}%)</span>
                      </td>
                      <td className="py-3 text-gray-700">
                        {s.revokedAt ? (
                          <span className="text-amber-700">Revoked</span>
                        ) : (
                          <span className="text-emerald-700">Active</span>
                        )}
                        {s.commentsDisabledAt && (
                          <span className="ml-1 text-xs text-amber-600">· comments off</span>
                        )}
                      </td>
                      <td className="space-x-3 px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => (msg ? dismissInvite(s.id) : handleInvite(s))}
                          disabled={inviteBusy[s.id]}
                          className="text-emerald-600 hover:underline disabled:opacity-40"
                        >
                          {inviteBusy[s.id] ? "…" : msg ? "Hide" : "Show invite"}
                        </button>
                        <Link
                          href={`/admin/subscribers/${s.id}`}
                          className="text-blue-600 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                    {msg && (
                      <tr className="bg-emerald-50">
                        <td colSpan={6} className="px-6 py-4">
                          <div className="flex items-start gap-4">
                            <pre className="flex-1 whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-800">
                              {msg}
                            </pre>
                            <div className="flex shrink-0 flex-col gap-2">
                              <button
                                type="button"
                                onClick={() => navigator.clipboard.writeText(msg)}
                                className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                              >
                                Copy message
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRegenerate(s)}
                                disabled={inviteBusy[s.id]}
                                className="rounded border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40"
                              >
                                {inviteBusy[s.id] ? "…" : "Regenerate"}
                              </button>
                              <button
                                type="button"
                                onClick={() => dismissInvite(s.id)}
                                className="text-xs text-gray-500 hover:underline"
                              >
                                Hide
                              </button>
                              <button
                                type="button"
                                onClick={() => forgetInvite(s.id)}
                                className="text-xs text-gray-400 hover:underline"
                                title="Forget this code from this browser. The subscriber's current code still works."
                              >
                                Forget here
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-gray-200 px-6 py-4">
        <h3 className="mb-3 text-sm font-medium text-gray-900">Add new subscriber</h3>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-gray-500 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[160px]">
            <label className="block text-xs text-gray-500 mb-1">Password</label>
            <input
              type="text"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              placeholder="gil-name"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[100px]">
            <label className="block text-xs text-gray-500 mb-1">Monthly budget USD</label>
            <input
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              inputMode="decimal"
              className="w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? "Adding..." : "Add subscriber"}
          </Button>
        </form>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {generated && (
          <div className="mt-3 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm">
            <p>
              <span className="font-semibold">{generated.name}</span> added — code{" "}
              <code className="rounded bg-white px-2 py-0.5 font-mono">{generated.code}</code>
              <button
                type="button"
                className="ml-2 text-blue-600 hover:underline"
                onClick={() => navigator.clipboard.writeText(generated.code)}
              >
                Copy
              </button>
              <button
                type="button"
                className="ml-2 text-gray-500 hover:underline"
                onClick={() => setGenerated(null)}
              >
                Dismiss
              </button>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
