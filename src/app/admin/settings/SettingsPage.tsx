"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, KeyRound } from "lucide-react";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  loginMethod: string;
}

type Subscriber = {
  id: string;
  name: string;
  email: string | null;
  monthlyBudgetUsd: number;
  cycleStart: string;
  cycleUsedUsd: number;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
};

export default function SettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Add user form
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  // Reset password
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  async function fetchUsers() {
    const res = await fetch("/api/users");
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => {
    void fetchUsers();
  }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    setAdding(true);

    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, name: newName, password: newPassword }),
    });

    setAdding(false);

    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || "Failed to add user");
      return;
    }

    setNewEmail("");
    setNewName("");
    setNewPassword("");
    await fetchUsers();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this user?")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to remove user");
    }
  }

  async function handleResetPassword(id: string) {
    if (!resetPassword) return;
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPassword }),
    });
    if (res.ok) {
      setResetId(null);
      setResetPassword("");
      alert("Password updated");
    } else {
      const data = await res.json();
      alert(data.error || "Failed to reset password");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="hidden text-2xl font-bold text-gray-900 md:block">Settings</h1>
        <p className="text-sm text-gray-500">Manage users and hub configuration</p>
      </div>

      {/* Admin section */}
      <section className="rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Admin</h2>
          <p className="text-sm text-gray-500">
            Everyone listed here has full admin access.
          </p>
        </div>

        {loading ? (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            Loading...
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {users.map((user) => (
              <li key={user.id} className="flex items-center gap-4 px-6 py-3">
                {user.image ? (
                  <img
                    src={user.image}
                    alt=""
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                    {(user.name?.[0] || user.email?.[0] || "?").toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {user.name || user.email}
                  </p>
                  <p className="truncate text-xs text-gray-500">
                    {user.email} · {user.loginMethod}
                  </p>
                </div>

                {resetId === user.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="New password"
                      value={resetPassword}
                      onChange={(e) => setResetPassword(e.target.value)}
                      className="w-32 rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={() => handleResetPassword(user.id)}
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResetId(null);
                        setResetPassword("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    {user.loginMethod === "credentials" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetId(user.id)}
                        title="Reset password"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDelete(user.id)}
                      title="Remove user"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Add user form */}
        <div className="border-t border-gray-200 px-6 py-4">
          <h3 className="mb-3 text-sm font-medium text-gray-900">
            Add new admin
          </h3>
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs text-gray-500 mb-1">Email</label>
              <input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="min-w-[120px]">
              <label className="block text-xs text-gray-500 mb-1">
                Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <Button type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add admin"}
            </Button>
          </form>
          {addError && (
            <p className="mt-2 text-sm text-red-600">{addError}</p>
          )}
        </div>
      </section>

      <SubscribersSection />
    </div>
  );
}

function deriveCodeFromName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]/g, "");
  return cleaned ? `gil-${cleaned}` : "";
}

function SubscribersSection() {
  const [list, setList] = useState<Subscriber[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordEdited, setPasswordEdited] = useState(false);
  const [budget, setBudget] = useState("1.20");
  const [generated, setGenerated] = useState<{ name: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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

  function handleNameChange(value: string) {
    setName(value);
    if (!passwordEdited) {
      setPassword(deriveCodeFromName(value));
    }
  }

  function handlePasswordChange(value: string) {
    setPassword(value);
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
    resetForm();
    void refresh();
  }

  async function handleRevoke(id: string, revoked: boolean) {
    await fetch(`/api/admin/subscribers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: !revoked }),
    });
    void refresh();
  }

  async function handleRegenerate(id: string, name: string) {
    if (!confirm(`Regenerate code for ${name}? The old code will stop working.`)) return;
    const res = await fetch(`/api/admin/subscribers/${id}/regenerate-code`, { method: "POST" });
    if (res.ok) {
      const { code } = await res.json();
      setGenerated({ name, code });
      void refresh();
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete ${name}? Their chat history will also be deleted.`)) return;
    await fetch(`/api/admin/subscribers/${id}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Subscribers</h2>
        <p className="text-sm text-gray-500">
          Per-person paid access to the public archive and chat.
        </p>
      </div>

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
                const pct = s.monthlyBudgetUsd > 0
                  ? Math.min(100, Math.round((s.cycleUsedUsd / s.monthlyBudgetUsd) * 100))
                  : 100;
                return (
                  <tr key={s.id}>
                    <td className="px-6 py-3 text-gray-900">{s.name}</td>
                    <td className="py-3 text-gray-700">{s.email ?? "—"}</td>
                    <td className="py-3 text-gray-700">
                      {s.lastSeenAt ? new Date(s.lastSeenAt).toLocaleString() : "—"}
                    </td>
                    <td className="py-3 text-gray-700">
                      ${s.cycleUsedUsd.toFixed(2)} / ${s.monthlyBudgetUsd.toFixed(2)}
                      <span className="ml-1 text-xs text-gray-500">({pct}%)</span>
                    </td>
                    <td className="py-3 text-gray-700">{s.revokedAt ? "Revoked" : "Active"}</td>
                    <td className="space-x-2 px-6 py-3 text-right whitespace-nowrap">
                      <button onClick={() => handleRegenerate(s.id, s.name)} className="text-blue-600 hover:underline">
                        Regenerate
                      </button>
                      <button onClick={() => handleRevoke(s.id, !!s.revokedAt)} className="text-blue-600 hover:underline">
                        {s.revokedAt ? "Restore" : "Revoke"}
                      </button>
                      <button onClick={() => handleDelete(s.id, s.name)} className="text-red-600 hover:underline">
                        Delete
                      </button>
                    </td>
                  </tr>
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
              placeholder="gil-Name"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[100px]">
            <label className="block text-xs text-gray-500 mb-1">
              Monthly budget USD
            </label>
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
