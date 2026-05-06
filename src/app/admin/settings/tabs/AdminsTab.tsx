"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, ShieldOff, ShieldCheck } from "lucide-react";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  isAdmin: boolean;
  loginMethod: string;
}

export function AdminsTab() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

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
      body: JSON.stringify({ email: newEmail, name: newName }),
    });

    setAdding(false);

    if (!res.ok) {
      const data = await res.json();
      setAddError(data.error || "Failed to add admin");
      return;
    }

    setNewEmail("");
    setNewName("");
    await fetchUsers();
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this user? Their posts and data will be deleted too.")) return;
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== id));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to remove user");
    }
  }

  async function handleToggleAdmin(id: string, makeAdmin: boolean) {
    const verb = makeAdmin ? "Promote" : "Demote";
    if (!confirm(`${verb} this user?`)) return;
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isAdmin: makeAdmin }),
    });
    if (res.ok) {
      await fetchUsers();
    } else {
      const data = await res.json();
      alert(data.error || `Failed to ${verb.toLowerCase()}`);
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-900">Admins</h2>
        <p className="text-sm text-gray-500">
          Sign-in is Google-only. Users marked admin can access the content hub.
          Adding an email here pre-authorizes their next Google sign-in.
        </p>
      </div>

      {loading ? (
        <div className="px-6 py-8 text-center text-sm text-gray-500">Loading...</div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {users.map((user) => (
            <li key={user.id} className="flex items-center gap-4 px-6 py-3">
              {user.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.image} alt="" className="h-8 w-8 rounded-full" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                  {(user.name?.[0] || user.email?.[0] || "?").toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">
                  {user.name || user.email}
                  {user.isAdmin && (
                    <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      admin
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {user.email}
                  {user.loginMethod !== "google" && (
                    <span className="ml-1 text-amber-600">· {user.loginMethod}</span>
                  )}
                </p>
              </div>

              <div className="flex items-center gap-1">
                {user.isAdmin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggleAdmin(user.id, false)}
                    title="Demote (revoke admin access)"
                  >
                    <ShieldOff className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleToggleAdmin(user.id, true)}
                    title="Promote to admin"
                  >
                    <ShieldCheck className="h-4 w-4" />
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
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-gray-200 px-6 py-4">
        <h3 className="mb-1 text-sm font-medium text-gray-900">
          Pre-authorize a new admin
        </h3>
        <p className="mb-3 text-xs text-gray-500">
          Enter the email of a Google account. They&apos;ll be allowed to sign in
          immediately — no redeploy needed.
        </p>
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs text-gray-500 mb-1">Google email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              required
              placeholder="someone@gmail.com"
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs text-gray-500 mb-1">Name (optional)</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <Button type="submit" disabled={adding}>
            {adding ? "Adding..." : "Add admin"}
          </Button>
        </form>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
      </div>
    </section>
  );
}
